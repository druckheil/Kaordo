package httpapi

// Verifies that host routes pass agent refusals through and hide agent failures
import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
)

type hostAgentStub struct{ err error }

func (stub hostAgentStub) Host(context.Context) (json.RawMessage, error) {
	return json.RawMessage(`{"host":{"name":"server"}}`), stub.err
}
func (stub hostAgentStub) PlanState(context.Context, json.RawMessage) (json.RawMessage, error) {
	return json.RawMessage(`{"steps":[],"issues":[]}`), stub.err
}
func (stub hostAgentStub) ApplyState(context.Context, json.RawMessage) (json.RawMessage, error) {
	return json.RawMessage(`{"document":{"revision":2}}`), stub.err
}
func (stub hostAgentStub) Operations(context.Context, int) (json.RawMessage, error) {
	return json.RawMessage(`{"items":[]}`), stub.err
}
func (stub hostAgentStub) Operation(context.Context, string) (json.RawMessage, error) {
	return nil, stub.err
}
func (stub hostAgentStub) CancelOperation(context.Context, string) (json.RawMessage, error) {
	return nil, stub.err
}
func (stub hostAgentStub) Alerts(context.Context, int64) (json.RawMessage, error) {
	return json.RawMessage(`{"host":"server","ntfy":null,"alerts":[{"key":"backup.none"}],"events":[],"sequence":1}`), stub.err
}
func (stub hostAgentStub) Usage(_ context.Context, window string) (json.RawMessage, error) {
	return json.RawMessage(`{"window":"` + window + `"}`), stub.err
}
func (stub hostAgentStub) MeasureUsage(context.Context) (json.RawMessage, error) {
	return json.RawMessage(`{"measuring":true}`), stub.err
}
func (stub hostAgentStub) Deploy(_ context.Context, request admin.DeploymentRequest) (json.RawMessage, error) {
	return json.RawMessage(`{"run":` + strconv.FormatInt(request.Run, 10) + `,"state":"waiting"}`), stub.err
}
func (stub hostAgentStub) Deployments(context.Context) (json.RawMessage, error) {
	return json.RawMessage(`{"items":[]}`), stub.err
}
func (stub hostAgentStub) Deployment(_ context.Context, run int64) (json.RawMessage, error) {
	return json.RawMessage(`{"run":` + strconv.FormatInt(run, 10) + `,"state":"deploying"}`), stub.err
}
func (stub hostAgentStub) StartCheck(context.Context, json.RawMessage) (json.RawMessage, error) {
	return json.RawMessage(`{"id":"op-1","kind":"integrity.scrub"}`), stub.err
}

func hostRouter(err error) http.Handler {
	users := &fakeUsers{user: account.User{ID: "01999111-2222-7333-8444-555555555551", Username: "operator", IsAdmin: true}}
	verify := func(context.Context, string) (identity.Claims, error) {
		return identity.Claims{Subject: "operator", Username: "operator"}, nil
	}
	store := &adminStub{}
	hosts := admin.NewHosts(map[string]admin.HostAgent{"local": hostAgentStub{err: err}}, store)
	alerts := admin.NewAlertDelivery(hosts, noticeStub{}, nil, time.Now)
	return NewRouter(verify, users, Modules{Admin: AdminDependencies{Store: store, Hosts: hosts, Alerts: alerts}}, nil)
}

type noticeStub struct{}

func (noticeStub) AlertCursor(context.Context, string) (int64, error)  { return 0, nil }
func (noticeStub) SetAlertCursor(context.Context, string, int64) error { return nil }
func (noticeStub) NotifyAdministrators(context.Context, string) error  { return nil }

func hostRequest(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer valid")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestHostRoutesProxyAgentsAndMapRefusals(t *testing.T) {
	if response := hostRequest(hostRouter(nil), http.MethodGet, "/v1/admin/hosts", ""); response.Code != 200 || !strings.Contains(response.Body.String(), `"local"`) {
		t.Fatalf("hosts = %d %s", response.Code, response.Body)
	}
	if response := hostRequest(hostRouter(nil), http.MethodGet, "/v1/admin/hosts/local", ""); response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("facts = %d %v", response.Code, response.Header())
	}
	if response := hostRequest(hostRouter(nil), http.MethodGet, "/v1/admin/hosts/elsewhere", ""); response.Code != 404 {
		t.Fatalf("unknown host = %d", response.Code)
	}
	refused := hostRouter(&admin.AgentError{Status: 422, Message: "Erasing a device needs its serial number."})
	response := hostRequest(refused, http.MethodPut, "/v1/admin/hosts/local/state", `{"document":{},"confirmations":[],"reason":"Grow the pool now"}`)
	if response.Code != 422 || !strings.Contains(response.Body.String(), "serial number") {
		t.Fatalf("refusal = %d %s", response.Code, response.Body)
	}
	oversized, err := json.Marshal(map[string]any{"document": map[string]any{}, "reason": strings.Repeat("x", 501)})
	if err != nil {
		t.Fatal(err)
	}
	if response := hostRequest(hostRouter(nil), http.MethodPut, "/v1/admin/hosts/local/state", string(oversized)); response.Code != 400 || !strings.Contains(response.Body.String(), "reason") {
		t.Fatalf("oversized reason = %d %s", response.Code, response.Body)
	}
	if response := hostRequest(hostRouter(nil), http.MethodPut, "/v1/admin/hosts/local/state", `{"document":{},"confirmations":[]}`); response.Code != 200 {
		t.Fatalf("change without a reason = %d %s", response.Code, response.Body)
	}
	if response := hostRequest(hostRouter(nil), http.MethodPut, "/v1/admin/hosts/local/state", `{"document":{},"unexpected":1}`); response.Code != 400 {
		t.Fatalf("unknown field = %d", response.Code)
	}
	if response := hostRequest(hostRouter(nil), http.MethodPost, "/v1/admin/hosts/local/operations", `{"kind":"integrity.scrub"}`); response.Code != 200 || !strings.Contains(response.Body.String(), "op-1") {
		t.Fatalf("start check = %d %s", response.Code, response.Body)
	}
	busy := hostRouter(&admin.AgentError{Status: 409, Message: "another integrity check is still running"})
	if response := hostRequest(busy, http.MethodPost, "/v1/admin/hosts/local/operations", `{"kind":"integrity.scrub","reason":"Verify every copy now"}`); response.Code != 409 {
		t.Fatalf("busy check = %d %s", response.Code, response.Body)
	}
	if response := hostRequest(hostRouter(nil), http.MethodGet, "/v1/admin/hosts/local/alerts", ""); response.Code != 200 || response.Body.String() != `{"alerts":[{"key":"backup.none"}]}`+"\n" {
		t.Fatalf("alerts = %d %q", response.Code, response.Body)
	}
	if response := hostRequest(hostRouter(nil), http.MethodPost, "/v1/admin/hosts/local/alerts/test", ""); response.Code != 200 || !strings.Contains(response.Body.String(), `"ntfy":"not configured"`) {
		t.Fatalf("test notice = %d %s", response.Code, response.Body)
	}
	if response := hostRequest(hostRouter(nil), http.MethodGet, "/v1/admin/hosts/local/usage?window=30d", ""); response.Code != 200 || !strings.Contains(response.Body.String(), `"window":"30d"`) {
		t.Fatalf("usage = %d %s", response.Code, response.Body)
	}
	if response := hostRequest(hostRouter(nil), http.MethodPost, "/v1/admin/hosts/local/usage/measure", ""); response.Code != 200 || !strings.Contains(response.Body.String(), "measuring") {
		t.Fatalf("measure = %d %s", response.Code, response.Body)
	}
	if response := hostRequest(hostRouter(nil), http.MethodGet, "/v1/admin/usage", ""); response.Code != 200 || !strings.Contains(response.Body.String(), `"addedWeek":1024`) {
		t.Fatalf("data usage = %d %s", response.Code, response.Body)
	}
	unavailable := hostRouter(errors.New("dial unix: no such file"))
	if response := hostRequest(unavailable, http.MethodGet, "/v1/admin/hosts/local/operations", ""); response.Code != 503 || strings.Contains(response.Body.String(), "dial") {
		t.Fatalf("agent failure = %d %s", response.Code, response.Body)
	}
}

func TestDeploymentHistoryRequiresAdministratorAccess(t *testing.T) {
	verify := func(context.Context, string) (identity.Claims, error) { return identity.Claims{Subject: "member"}, nil }
	users := &fakeUsers{user: account.User{ID: "01999111-2222-7333-8444-555555555551", IsAdmin: false}}
	hosts := admin.NewHosts(map[string]admin.HostAgent{"local": hostAgentStub{}}, &adminStub{})
	router := NewRouter(verify, users, Modules{Admin: AdminDependencies{Store: &adminStub{}, Hosts: hosts}}, nil)
	for _, path := range []string{"/v1/admin/hosts/local/deployments", "/v1/admin/hosts/local/deployments/42"} {
		if response := hostRequest(router, http.MethodGet, path, ""); response.Code != http.StatusForbidden {
			t.Fatalf("member reads %s = %d", path, response.Code)
		}
		if response := hostRequest(hostRouter(nil), http.MethodGet, path, ""); response.Code != http.StatusOK {
			t.Fatalf("administrator reads %s = %d %s", path, response.Code, response.Body)
		}
	}
	if response := hostRequest(hostRouter(nil), http.MethodGet, "/v1/admin/hosts/local/deployments/not-a-run", ""); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid run = %d", response.Code)
	}
}
