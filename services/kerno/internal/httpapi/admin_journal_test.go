package httpapi

// Checks administrator permission and audit ordering for host-wide retention changes
import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
)

type journalAdminFixture struct {
	*storageAdminFixture
	calls int
	fail  bool
}

func (fixture *journalAdminFixture) SetLogRetention(_ context.Context, days int) (json.RawMessage, error) {
	fixture.calls++
	if fixture.store.records != 1 || fixture.fail {
		return nil, errors.New("audit or agent unavailable")
	}
	return json.Marshal(map[string]any{"retentionDays": days, "managed": true})
}

func TestAdminJournalRetentionAuthorizationAndAudit(t *testing.T) {
	for _, check := range []struct {
		name, body                        string
		admin, auditFailure, agentFailure bool
		status, calls                     int
	}{
		{"valid", `{"retentionDays":7,"reason":"Reduce journal history duration"}`, true, false, false, 200, 1},
		{"size only", `{"retentionDays":0,"reason":"Retain until storage rotation"}`, true, false, false, 200, 1},
		{"non-admin", `{"retentionDays":7,"reason":"Reduce journal history duration"}`, false, false, false, 403, 0},
		{"unsupported", `{"retentionDays":10000,"reason":"Reduce journal history duration"}`, true, false, false, 400, 0},
		{"missing period", `{"reason":"Reduce journal history duration"}`, true, false, false, 400, 0},
		{"missing reason", `{"retentionDays":7}`, true, false, false, 400, 0},
		{"unknown field", `{"retentionDays":7,"reason":"Reduce journal history duration","path":"/etc"}`, true, false, false, 400, 0},
		{"audit failure", `{"retentionDays":7,"reason":"Reduce journal history duration"}`, true, true, false, 500, 0},
		{"agent failure", `{"retentionDays":7,"reason":"Reduce journal history duration"}`, true, false, true, 500, 1},
	} {
		t.Run(check.name, func(t *testing.T) {
			store := &adminStub{}
			if check.auditFailure {
				store.recordError = errors.New("audit unavailable")
			}
			fixture := &journalAdminFixture{storageAdminFixture: &storageAdminFixture{store: store}, fail: check.agentFailure}
			users := &fakeUsers{user: account.User{ID: "01999111-2222-7333-8444-555555555551", IsAdmin: check.admin}}
			verify := func(context.Context, string) (identity.Claims, error) {
				return identity.Claims{Subject: "operator"}, nil
			}
			handler := NewRouter(verify, users, Modules{Fluo: FluoDependencies{}, Ligo: LigoDependencies{}, Rondo: RondoDependencies{}, Admin: AdminDependencies{Store: store, System: fixture}}, nil)
			request := httptest.NewRequest("PATCH", "/v1/admin/logs/retention", strings.NewReader(check.body))
			request.Header.Set("Authorization", "Bearer valid")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != check.status || fixture.calls != check.calls {
				t.Fatalf("status=%d calls=%d: %s", response.Code, fixture.calls, response.Body.String())
			}
		})
	}
}
