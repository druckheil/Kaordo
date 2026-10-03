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
)

type adminStub struct {
	summaryCalls, records, reads int
	recordError                  error
}

func (store *adminStub) Summary(context.Context) (postgres.AdminSummary, error) {
	store.summaryCalls++
	return postgres.AdminSummary{Users: 2}, nil
}
func (*adminStub) Users(context.Context, string) ([]postgres.AdminUser, error) { return nil, nil }
func (*adminStub) SetDisabled(context.Context, string, string, bool, string) (postgres.AdminUser, error) {
	return postgres.AdminUser{}, nil
}
func (*adminStub) SetAdmin(context.Context, string, string, bool, string) (postgres.AdminUser, error) {
	return postgres.AdminUser{}, nil
}
func (*adminStub) CloseCase(context.Context, string, string) error           { return nil }
func (*adminStub) Audit(context.Context) ([]postgres.AdminAuditEntry, error) { return nil, nil }
func (store *adminStub) Record(context.Context, string, string, string, string, any) error {
	store.records++
	return store.recordError
}
func (*adminStub) CreateAccessCase(context.Context, string, string, string) (postgres.AdminAccessCase, error) {
	return postgres.AdminAccessCase{}, nil
}
func (*adminStub) AccessCase(context.Context, string, string) (postgres.AdminAccessCase, error) {
	return postgres.AdminAccessCase{TargetUserID: "01999111-2222-7333-8444-555555555552", Reason: "Documented access case"}, nil
}
func (store *adminStub) CaseContent(context.Context, string, string, string) (postgres.AdminContentPage, error) {
	store.reads++
	return postgres.AdminContentPage{Items: []postgres.AdminContent{{ID: "01999111-2222-7333-8444-555555555553", Media: []postgres.AdminContentMedia{{ID: "01999111-2222-7333-8444-555555555554"}}}}}, nil
}

func TestAdminRoutesRequireCurrentAdministrator(t *testing.T) {
	store := &adminStub{}
	users := &fakeUsers{user: postgres.User{ID: "01999111-2222-7333-8444-555555555551", Username: "operator", IsAdmin: false}}
	verify := func(context.Context, string) (identity.Claims, error) {
		return identity.Claims{Subject: "operator", Username: "operator"}, nil
	}
	handler := NewRouterWithAdmin(verify, users, FluoDependencies{}, LigoDependencies{}, RondoDependencies{}, AdminDependencies{Store: store}, nil)
	for _, test := range []struct {
		token  string
		status int
	}{{"", 401}, {"Bearer valid", 403}} {
		request := httptest.NewRequest(http.MethodGet, "/v1/admin/summary", nil)
		request.Header.Set("Authorization", test.token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Fatalf("%q: %d", test.token, response.Code)
		}
	}
	if store.summaryCalls != 0 {
		t.Fatal("unauthorized call reached admin store")
	}
	users.user.IsAdmin = true
	request := httptest.NewRequest(http.MethodGet, "/v1/admin/summary", nil)
	request.Header.Set("Authorization", "Bearer valid")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 200 || store.summaryCalls != 1 {
		t.Fatalf("authorized request = %d, calls %d", response.Code, store.summaryCalls)
	}
	now := time.Now()
	users.user.DisabledAt = &now
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 403 || store.summaryCalls != 1 {
		t.Fatalf("disabled admin = %d", response.Code)
	}
}

func TestAdminCaseReadAuditsBeforeContentAndSignsMedia(t *testing.T) {
	store := &adminStub{}
	users := &fakeUsers{user: postgres.User{ID: "01999111-2222-7333-8444-555555555551", IsAdmin: true}}
	verify := func(context.Context, string) (identity.Claims, error) {
		return identity.Claims{Subject: "operator", Username: "operator"}, nil
	}
	handler := NewRouterWithAdmin(verify, users, FluoDependencies{}, LigoDependencies{}, RondoDependencies{}, AdminDependencies{
		Store: store, MediaBaseURL: "https://kaordo.link", MediaSignKey: []byte(strings.Repeat("k", 32)),
	}, nil)
	request := httptest.NewRequest(http.MethodGet, "/v1/admin/cases/01999111-2222-7333-8444-555555555550/content?kind=posts", nil)
	request.Header.Set("Authorization", "Bearer valid")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 200 || store.records != 1 || store.reads != 1 {
		t.Fatalf("case read = %d, audit %d, reads %d: %s", response.Code, store.records, store.reads, response.Body.String())
	}
	var page postgres.AdminContentPage
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(page.Items[0].Media[0].URL, "sig=") {
		t.Fatal("admin media URL was not signed")
	}
	store.reads = 0
	store.recordError = errors.New("audit unavailable")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 500 || store.reads != 0 {
		t.Fatalf("audit failure allowed content read: %d / %d", response.Code, store.reads)
	}
}

func TestAdminStatusAndRoleRequireExplicitValues(t *testing.T) {
	users := &fakeUsers{user: postgres.User{ID: "01999111-2222-7333-8444-555555555551", IsAdmin: true}}
	verify := func(context.Context, string) (identity.Claims, error) {
		return identity.Claims{Subject: "operator", Username: "operator"}, nil
	}
	handler := NewRouterWithAdmin(verify, users, FluoDependencies{}, LigoDependencies{}, RondoDependencies{}, AdminDependencies{Store: &adminStub{}}, nil)
	for _, path := range []string{"status", "role"} {
		request := httptest.NewRequest(http.MethodPatch, "/v1/admin/users/01999111-2222-7333-8444-555555555552/"+path, strings.NewReader(`{"reason":"A valid documented reason"}`))
		request.Header.Set("Authorization", "Bearer valid")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 400 {
			t.Fatalf("%s accepted a missing value: %d", path, response.Code)
		}
	}
}
