package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
	"github.com/jackc/pgx/v5"
)

type fakeUsers struct {
	user    postgres.User
	upserts int
	lookups int
	lastSub string
}

func (store *fakeUsers) Upsert(_ context.Context, subject, _, _ string) (postgres.User, error) {
	store.upserts++
	store.lastSub = subject
	return store.user, nil
}

func (store *fakeUsers) BySubject(_ context.Context, subject string) (postgres.User, error) {
	store.lookups++
	store.lastSub = subject
	if store.user.ID == "" {
		return postgres.User{}, pgx.ErrNoRows
	}
	return store.user, nil
}

func TestSessionRequiresVerifiedBearerToken(t *testing.T) {
	store := &fakeUsers{}
	verify := func(_ context.Context, raw string) (identity.Claims, error) {
		if raw != "valid" {
			return identity.Claims{}, errors.New("invalid")
		}
		return identity.Claims{Subject: "subject-1", Username: "alice", Name: "Alice"}, nil
	}
	handler := NewRouter(verify, store, []string{"http://localhost:5173"})
	for _, test := range []struct{ header, code string }{
		{"", "missing_token"},
		{"Basic valid", "missing_token"},
		{"Bearer invalid", "invalid_token"},
		{"Bearer valid extra", "missing_token"},
	} {
		request := httptest.NewRequest(http.MethodPost, "/v1/session", nil)
		request.Header.Set("Authorization", test.header)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("header %q: got %d, want 401", test.header, response.Code)
		}
		var body struct {
			Code  string `json:"code"`
			Error string `json:"error"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Code != test.code || body.Error == "" || strings.Contains(response.Body.String(), "private") {
			t.Fatalf("unexpected safe failure: %+v", body)
		}
	}
	if store.upserts != 0 {
		t.Fatal("unverified requests wrote to the user store")
	}
}

func TestSessionReportsSafeVerificationReason(t *testing.T) {
	store := &fakeUsers{}
	handler := NewRouter(func(context.Context, string) (identity.Claims, error) {
		return identity.Claims{}, errors.New(`oidc: expected audience "kerno-api" got ["private-audience"]`)
	}, store, nil)
	request := httptest.NewRequest(http.MethodPost, "/v1/session", nil)
	request.Header.Set("Authorization", "Bearer private-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"invalid_audience"`) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "private") || store.upserts != 0 {
		t.Fatal("a rejected token or verifier detail escaped into the response")
	}
}

func TestSessionCreatesIdentityAndMeReadsIt(t *testing.T) {
	store := &fakeUsers{user: postgres.User{
		ID: "01999abc-1234-7000-8000-000000000001", Username: "alice", DisplayName: "Alice", CreatedAt: time.Now().UTC(),
	}}
	verify := func(_ context.Context, raw string) (identity.Claims, error) {
		if raw != "valid" {
			return identity.Claims{}, errors.New("invalid")
		}
		return identity.Claims{Subject: "subject-1", Username: "alice", Name: "Alice"}, nil
	}
	handler := NewRouter(verify, store, []string{"http://localhost:5173"})
	for _, tc := range []struct{ method, path string }{{http.MethodPost, "/v1/session"}, {http.MethodGet, "/v1/me"}} {
		request := httptest.NewRequest(tc.method, tc.path, nil)
		request.Header.Set("Authorization", "Bearer valid")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("%s: got %d", tc.path, response.Code)
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("private response may be cached")
		}
		var user postgres.User
		if err := json.Unmarshal(response.Body.Bytes(), &user); err != nil {
			t.Fatal(err)
		}
		if user.ID != store.user.ID {
			t.Fatalf("unexpected user ID: %s", user.ID)
		}
	}
	if store.upserts != 1 || store.lookups != 1 || store.lastSub != "subject-1" {
		t.Fatalf("unexpected store calls: %+v", store)
	}
}

func TestCorsRejectsUnknownOrigin(t *testing.T) {
	store := &fakeUsers{}
	handler := NewRouter(func(context.Context, string) (identity.Claims, error) {
		t.Fatal("verifier should not be called")
		return identity.Claims{}, nil
	}, store, []string{"http://localhost:5173"})
	request := httptest.NewRequest(http.MethodPost, "/v1/session", nil)
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("invalid CORS response: %d %v", response.Code, response.Header())
	}
	if !strings.Contains(response.Body.String(), "Origin is not allowed") {
		t.Fatal(response.Body.String())
	}
}

func TestMeRequiresExistingProjection(t *testing.T) {
	handler := NewRouter(func(context.Context, string) (identity.Claims, error) {
		return identity.Claims{Subject: "new", Username: "new", Name: "New"}, nil
	}, &fakeUsers{}, nil)
	request := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	request.Header.Set("Authorization", "Bearer valid")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404", response.Code)
	}
}
