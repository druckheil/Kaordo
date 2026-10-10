package httpapi

// Checks administrator authorization and audit ordering before host and media actions
import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
	"github.com/druckheil/Kaordo/services/kerno/internal/nodoclient"
	"github.com/druckheil/Kaordo/services/mediaauth"
)

type actionFixture struct {
	store          *adminStub
	state          string
	actions, media int
	clean          bool
}

func (*actionFixture) Snapshot(context.Context) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}
func (*actionFixture) Logs(context.Context, string) (json.RawMessage, error) { return nil, nil }
func (fixture *actionFixture) Action(context.Context, string) (json.RawMessage, error) {
	fixture.actions++
	if fixture.store.records != 1 {
		return nil, errors.New("operation reached the agent before audit")
	}
	return json.RawMessage(`{"accepted":true}`), nil
}
func (fixture *actionFixture) MediaStatus(context.Context) (json.RawMessage, error) {
	return json.Marshal(map[string]string{"directory": "/srv/data/media", "state": fixture.state})
}
func (fixture *actionFixture) StartMediaMaintenance(_ context.Context, clean bool) error {
	fixture.media++
	fixture.clean = clean
	if fixture.store.records != 1 {
		return errors.New("cleanup reached Nodo before audit")
	}
	return nil
}

func TestAdminActionsAuthorizeAndAuditBeforeReachingWorkers(t *testing.T) {
	for _, test := range []struct {
		name, action, state         string
		administrator, auditFailure bool
		status, actions, media      int
	}{
		{"restart reaches the agent", "restart-nodo", "idle", true, false, 202, 1, 0},
		{"media check reaches Nodo", "check-media", "idle", true, false, 202, 0, 1},
		{"media cleanup reaches Nodo", "clean-media", "idle", true, false, 202, 0, 1},
		{"removed storage action refused", "repair-storage", "idle", true, false, 400, 0, 0},
		{"non-admin refused", "clean-media", "idle", false, false, 403, 0, 0},
		{"audit failure refused", "clean-media", "idle", true, true, 500, 0, 0},
		{"busy media refused", "clean-media", "repairing", true, false, 409, 0, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &adminStub{}
			if test.auditFailure {
				store.recordError = errors.New("audit unavailable")
			}
			fixture := &actionFixture{store: store, state: test.state}
			users := &fakeUsers{user: account.User{ID: "01999111-2222-7333-8444-555555555551", IsAdmin: test.administrator}}
			verify := func(context.Context, string) (identity.Claims, error) {
				return identity.Claims{Subject: "operator"}, nil
			}
			handler := NewRouter(verify, users, Modules{Fluo: FluoDependencies{}, Ligo: LigoDependencies{}, Rondo: RondoDependencies{}, Admin: AdminDependencies{Store: store, System: fixture, Media: fixture}}, nil)
			request := httptest.NewRequest("POST", "/v1/admin/actions/"+test.action, strings.NewReader(`{}`))
			request.Header.Set("Authorization", "Bearer valid")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.status || fixture.actions != test.actions || fixture.media != test.media {
				t.Fatalf("response = %d, agent = %d, Nodo = %d: %s", response.Code, fixture.actions, fixture.media, response.Body.String())
			}
			if fixture.media > 0 && fixture.clean != (test.action == "clean-media") {
				t.Fatalf("%s reached Nodo with clean = %v", test.action, fixture.clean)
			}
		})
	}
}

func TestNodoMediaClientAuthenticatesAndRejectsUnavailableOperations(t *testing.T) {
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
	if value, err := client.MediaStatus(context.Background()); err != nil || !strings.Contains(string(value), "/srv/data/media") {
		t.Fatalf("status = %s / %v", value, err)
	}
	if err := client.StartMediaMaintenance(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	if err := client.StartMediaMaintenance(context.Background(), true); err == nil {
		t.Fatal("conflicting operation accepted")
	}
	client.InternalKey = nil
	if _, err := client.MediaStatus(context.Background()); err == nil {
		t.Fatal("missing internal key accepted")
	}
}
