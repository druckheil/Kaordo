package regado

// Calls fixed host operations over the protected system-agent Unix socket
import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"
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
	return client.call(ctx, http.MethodGet, "/snapshot", nil)
}

func (client *SystemClient) Logs(ctx context.Context, service string) (json.RawMessage, error) {
	path := "/logs?service=" + url.QueryEscape(service)
	return client.call(ctx, http.MethodGet, path, nil)
}

func (client *SystemClient) Action(ctx context.Context, action string) (json.RawMessage, error) {
	return client.call(ctx, http.MethodPost, "/actions/"+url.PathEscape(action), nil)
}
