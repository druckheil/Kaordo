package httpapi

// Checks administrator authorization, audit ordering, and coordinated storage jobs
import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
	"github.com/druckheil/Kaordo/services/kerno/internal/nodoclient"
	"github.com/druckheil/Kaordo/services/mediaauth"
)

type storageAdminFixture struct {
	store                *adminStub
	directory, state     string
	actions, maintenance int
	repair               bool
}

func (fixture *storageAdminFixture) Snapshot(context.Context) (json.RawMessage, error) {
	return json.RawMessage(`{"replicationReports":[]}`), nil
}
func (*storageAdminFixture) Logs(context.Context, string) (json.RawMessage, error) { return nil, nil }
func (fixture *storageAdminFixture) Action(_ context.Context, _ string, request admin.ActionRequest) (json.RawMessage, error) {
	fixture.actions++
	if fixture.store.records != 1 {
		return nil, errors.New("operation reached the agent before audit")
	}
	if request.Target != "/srv/data" {
		return nil, errors.New("wrong data pool")
	}
	return json.RawMessage(`{"accepted":true}`), nil
}
func (fixture *storageAdminFixture) StorageStatus(context.Context) (json.RawMessage, error) {
	value, _ := json.Marshal(map[string]string{"directory": fixture.directory, "state": fixture.state})
	return value, nil
}
func (fixture *storageAdminFixture) StartStorageMaintenance(_ context.Context, repair bool) error {
	fixture.maintenance++
	fixture.repair = repair
	if fixture.actions != 1 {
		return errors.New("cleanup reached Nodo before the agent validated the pool")
	}
	return nil
}

func TestAdminStorageChecksAuthorizeAndAuditBeforeStartingWorkers(t *testing.T) {
	for _, test := range []struct {
		name, target, directory, state string
		administrator, auditFailure    bool
		status, actions, maintenance   int
	}{
		{"valid repair", "/srv/data", "/srv/data/media", "idle", true, false, 202, 1, 1},
		{"other pool does not clean Nodo", "/srv/data", "/srv/other/media", "idle", true, false, 202, 1, 0},
		{"system root refused", "/", "/srv/data/media", "idle", true, false, 400, 0, 0},
		{"unclean path refused", "/srv/data/../data", "/srv/data/media", "idle", true, false, 400, 0, 0},
		{"non-admin refused", "/srv/data", "/srv/data/media", "idle", false, false, 403, 0, 0},
		{"audit failure refused", "/srv/data", "/srv/data/media", "idle", true, true, 500, 0, 0},
		{"busy worker refused", "/srv/data", "/srv/data/media", "repairing", true, false, 409, 0, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &adminStub{}
			if test.auditFailure {
				store.recordError = errors.New("audit unavailable")
			}
			fixture := &storageAdminFixture{store: store, directory: test.directory, state: test.state}
			users := &fakeUsers{user: account.User{ID: "01999111-2222-7333-8444-555555555551", IsAdmin: test.administrator}}
			verify := func(context.Context, string) (identity.Claims, error) {
				return identity.Claims{Subject: "operator"}, nil
			}
			handler := NewRouter(verify, users, Modules{Fluo: FluoDependencies{}, Ligo: LigoDependencies{}, Rondo: RondoDependencies{}, Admin: AdminDependencies{Store: store, System: fixture, Maintenance: fixture}}, nil)
			body, _ := json.Marshal(map[string]string{"target": test.target, "reason": "Verify and repair file copies"})
			request := httptest.NewRequest("POST", "/v1/admin/actions/repair-storage", strings.NewReader(string(body)))
			request.Header.Set("Authorization", "Bearer valid")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.status || fixture.actions != test.actions || fixture.maintenance != test.maintenance {
				t.Fatalf("response = %d, agent = %d, Nodo = %d: %s", response.Code, fixture.actions, fixture.maintenance, response.Body.String())
			}
			if fixture.maintenance > 0 && !fixture.repair {
				t.Fatal("repair reached Nodo as a read-only check")
			}
		})
	}
}

func TestNodoStorageClientAuthenticatesAndRejectsUnavailableOperations(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	var posts int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !mediaauth.VerifyInternalToken(r.Header.Get("X-Kaordo-Internal-Token"), key) {
			w.WriteHeader(403)
			return
		}
		if r.Method == "GET" {
			_, _ = w.Write([]byte(`{"directory":"/srv/data/media","state":"idle"}`))
			return
		}
		posts++
		if posts == 1 && strings.HasSuffix(r.URL.Path, "/check") {
			w.WriteHeader(202)
			return
		}
		w.WriteHeader(409)
	}))
	defer server.Close()
	client := nodoclient.Client{BaseURL: server.URL, InternalKey: key}
	if value, err := client.StorageStatus(context.Background()); err != nil || !strings.Contains(string(value), "/srv/data/media") {
		t.Fatalf("status = %s / %v", value, err)
	}
	if err := client.StartStorageMaintenance(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	if err := client.StartStorageMaintenance(context.Background(), true); err == nil {
		t.Fatal("conflicting operation accepted")
	}
	client.InternalKey = nil
	if _, err := client.StorageStatus(context.Background()); err == nil {
		t.Fatal("missing internal key accepted")
	}
}
