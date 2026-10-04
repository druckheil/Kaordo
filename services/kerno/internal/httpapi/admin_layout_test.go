package httpapi

// Verifies administrator-only layout previews and audit-before-apply boundaries
import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
	"github.com/druckheil/Kaordo/services/kerno/internal/regado"
)

type layoutAdminFixture struct {
	*storageAdminFixture
	calls int
	fail  bool
}

func (fixture *layoutAdminFixture) StorageLayout(_ context.Context, _ regado.LayoutRequest, apply bool) (json.RawMessage, error) {
	fixture.calls++
	if apply && fixture.store.records != 1 {
		return nil, errors.New("operation reached the agent before audit")
	}
	if !apply && fixture.store.records != 0 {
		return nil, errors.New("preview created a mutation audit")
	}
	if fixture.fail {
		return nil, errors.New("stale layout")
	}
	return json.RawMessage(`{"accepted":true}`), nil
}

func TestAdministratorLayoutPreviewAndApplyGuards(t *testing.T) {
	for _, check := range []struct {
		name, operation, device, fingerprint, confirmation string
		admin, auditFailure, agentFailure                  bool
		status, calls                                      int
	}{
		{"preview", "plan", "/dev/sdc", "", "", true, false, false, 200, 1},
		{"apply", "apply", "/dev/sdc", strings.Repeat("a", 64), "/dev/sdc", true, false, false, 202, 1},
		{"non-admin", "apply", "/dev/sdc", strings.Repeat("a", 64), "/dev/sdc", false, false, false, 403, 0},
		{"audit failure", "apply", "/dev/sdc", strings.Repeat("a", 64), "/dev/sdc", true, true, false, 500, 0},
		{"stale review", "apply", "/dev/sdc", strings.Repeat("a", 64), "/dev/sdc", true, false, true, 409, 1},
		{"missing confirmation", "apply", "/dev/sdc", strings.Repeat("a", 64), "", true, false, false, 400, 0},
		{"non-hex fingerprint", "apply", "/dev/sdc", strings.Repeat("z", 64), "/dev/sdc", true, false, false, 400, 0},
		{"unsafe path", "plan", "/dev/../etc/passwd", "", "", true, false, false, 400, 0},
	} {
		t.Run(check.name, func(t *testing.T) {
			store := &adminStub{}
			if check.auditFailure {
				store.recordError = errors.New("audit unavailable")
			}
			fixture := &layoutAdminFixture{storageAdminFixture: &storageAdminFixture{store: store}, fail: check.agentFailure}
			users := &fakeUsers{user: postgres.User{ID: "01999111-2222-7333-8444-555555555551", IsAdmin: check.admin}}
			verify := func(context.Context, string) (identity.Claims, error) {
				return identity.Claims{Subject: "operator"}, nil
			}
			handler := NewRouterWithAdmin(verify, users, FluoDependencies{}, LigoDependencies{}, RondoDependencies{}, AdminDependencies{Store: store, System: fixture}, nil)
			body, _ := json.Marshal(map[string]any{"device": check.device, "identity": "serial:unique", "filesystem": "/srv/data", "systemBytes": int64(64 << 30), "storageBytes": int64(800 << 30), "fingerprint": check.fingerprint, "confirmation": check.confirmation, "reason": "Allocate the reviewed device"})
			request := httptest.NewRequest("POST", "/v1/admin/storage/"+check.operation, strings.NewReader(string(body)))
			request.Header.Set("Authorization", "Bearer valid")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != check.status || fixture.calls != check.calls {
				t.Fatalf("status=%d agent calls=%d: %s", response.Code, fixture.calls, response.Body.String())
			}
		})
	}
}
