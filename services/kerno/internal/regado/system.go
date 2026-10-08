package regado

// Calls fixed host operations over the protected system-agent Unix socket
import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
)

const (
	systemAgentTimeout = 35 * time.Second
	maxResponseSize    = 2 << 20
)

// SystemClient reads snapshots, logs, and actions through the local agent socket
type SystemClient struct {
	client *http.Client
}

func NewSystemClient(socket string) *SystemClient {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "unix", socket)
		},
	}
	return &SystemClient{
		client: &http.Client{Transport: transport, Timeout: systemAgentTimeout},
	}
}

func (client *SystemClient) request(ctx context.Context, method, path string) (json.RawMessage, error) {
	return client.requestBody(ctx, method, path, nil)
}

func (client *SystemClient) requestBody(ctx context.Context, method, path string, body io.Reader) (json.RawMessage, error) {
	request, err := http.NewRequestWithContext(ctx, method, "http://regado-agent"+path, body)
	if err != nil {
		return nil, err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := client.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("system agent returned %d", response.StatusCode)
	}
	return readJSONResponse(response.Body)
}

func readJSONResponse(body io.Reader) (json.RawMessage, error) {
	data, err := io.ReadAll(io.LimitReader(body, maxResponseSize+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxResponseSize {
		return nil, errors.New("system response exceeds the size limit")
	}
	if !json.Valid(data) {
		return nil, errors.New("invalid system agent response")
	}
	return data, nil
}

func (client *SystemClient) Snapshot(ctx context.Context) (json.RawMessage, error) {
	return client.request(ctx, http.MethodGet, "/snapshot")
}

func (client *SystemClient) Logs(ctx context.Context, service string) (json.RawMessage, error) {
	path := "/logs?service=" + url.QueryEscape(service)
	return client.request(ctx, http.MethodGet, path)
}

func (client *SystemClient) SetLogRetention(ctx context.Context, days int) (json.RawMessage, error) {
	payload, err := json.Marshal(map[string]int{"retentionDays": days})
	if err != nil {
		return nil, err
	}
	return client.requestBody(ctx, http.MethodPatch, "/logs/retention", bytes.NewReader(payload))
}

func (client *SystemClient) Action(ctx context.Context, action string, request admin.ActionRequest) (json.RawMessage, error) {
	path := "/actions/" + url.PathEscape(action)
	payload, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	return client.requestBody(ctx, http.MethodPost, path, bytes.NewReader(payload))
}

func (client *SystemClient) StorageLayout(ctx context.Context, request admin.LayoutRequest, apply bool) (json.RawMessage, error) {
	path := "/storage/plan"
	if apply {
		path = "/storage/apply"
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	return client.requestBody(ctx, http.MethodPost, path, bytes.NewReader(payload))
}
