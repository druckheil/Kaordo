package regado

// Implements the host agent port: desired state, facts and operations over the agent socket
import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
)

var _ admin.HostAgent = (*SystemClient)(nil)

func (client *SystemClient) Host(ctx context.Context) (json.RawMessage, error) {
	return client.call(ctx, http.MethodGet, "/host", nil)
}

func (client *SystemClient) PlanState(ctx context.Context, document json.RawMessage) (json.RawMessage, error) {
	return client.call(ctx, http.MethodPost, "/state/plan", document)
}

func (client *SystemClient) ApplyState(ctx context.Context, change json.RawMessage) (json.RawMessage, error) {
	return client.call(ctx, http.MethodPut, "/state", change)
}

func (client *SystemClient) Operations(ctx context.Context, limit int) (json.RawMessage, error) {
	return client.call(ctx, http.MethodGet, "/operations?limit="+strconv.Itoa(limit), nil)
}

func (client *SystemClient) Operation(ctx context.Context, id string) (json.RawMessage, error) {
	return client.call(ctx, http.MethodGet, "/operations/"+url.PathEscape(id), nil)
}

func (client *SystemClient) CancelOperation(ctx context.Context, id string) (json.RawMessage, error) {
	return client.call(ctx, http.MethodPost, "/operations/"+url.PathEscape(id)+"/cancel", nil)
}

func (client *SystemClient) Alerts(ctx context.Context, after int64) (json.RawMessage, error) {
	return client.call(ctx, http.MethodGet, "/alerts?after="+strconv.FormatInt(after, 10), nil)
}

func (client *SystemClient) Usage(ctx context.Context, window string) (json.RawMessage, error) {
	return client.call(ctx, http.MethodGet, "/usage?window="+url.QueryEscape(window), nil)
}

func (client *SystemClient) MeasureUsage(ctx context.Context) (json.RawMessage, error) {
	return client.call(ctx, http.MethodPost, "/usage/measure", nil)
}

func (client *SystemClient) StartCheck(ctx context.Context, check json.RawMessage) (json.RawMessage, error) {
	return client.call(ctx, http.MethodPost, "/operations", check)
}

// call returns the agent's JSON, or an AgentError carrying the agent's status and message
func (client *SystemClient) call(ctx context.Context, method, path string, body json.RawMessage) (json.RawMessage, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, "http://regado-agent"+path, reader)
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
	data, err := readJSONResponse(response.Body)
	if response.StatusCode == http.StatusOK {
		return data, err
	}
	var refusal struct {
		Error string `json:"error"`
	}
	if err != nil || json.Unmarshal(data, &refusal) != nil || refusal.Error == "" {
		refusal.Error = "The host agent refused the request."
	}
	return nil, &admin.AgentError{Status: response.StatusCode, Message: refusal.Error}
}
