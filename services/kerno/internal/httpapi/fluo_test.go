package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
	"github.com/druckheil/Kaordo/services/mediaauth"
)

type fluoStoreStub struct {
	created   int
	listed    int
	lastMedia []fluo.Media
}

func (store *fluoStoreStub) Create(_ context.Context, actor string, input fluo.NewPost, text string, media []fluo.Media) (fluo.Post, error) {
	store.created++
	store.lastMedia = media
	return fluo.Post{ID: "01999111-2222-7333-8444-555555555555", Author: fluo.Author{ID: actor, Username: "alice", DisplayName: "Alice"},
		Content: input.Content, Text: text, Visibility: input.Visibility, Media: media, CreatedAt: time.Now(), UpdatedAt: time.Now()}, nil
}
func (store *fluoStoreStub) Get(context.Context, string, string) (fluo.Post, error) {
	return fluo.Post{}, fluo.ErrNotFound
}
func (store *fluoStoreStub) List(context.Context, fluo.ListOptions) (fluo.Page, error) {
	store.listed++
	return fluo.Page{Items: []fluo.Post{}}, nil
}
func (store *fluoStoreStub) Delete(context.Context, string, string) ([]string, error) {
	return nil, fluo.ErrNotFound
}
func (store *fluoStoreStub) MediaReferenced(context.Context, string) (bool, error) { return false, nil }
func (store *fluoStoreStub) React(context.Context, string, string, *string) (fluo.Post, error) {
	return fluo.Post{}, fluo.ErrNotFound
}
func (store *fluoStoreStub) Follow(context.Context, string, string, bool) error { return nil }

type mediaStub struct{ valid bool }

func (stub mediaStub) Validate(_ context.Context, _, id string) (fluo.Media, error) {
	if !stub.valid {
		return fluo.Media{}, errors.New("not owned")
	}
	return fluo.Media{ID: id, Kind: "image", MimeType: "image/png", Width: 8, Height: 6, Size: 80}, nil
}
func (stub mediaStub) Purge(context.Context, string) error { return nil }

func TestFluoCreateRequiresVerifiedOwnedMediaAndSafeContent(t *testing.T) {
	store := &fluoStoreStub{}
	users := &fakeUsers{user: postgres.User{ID: "01999111-2222-7333-8444-555555555554", Username: "alice", DisplayName: "Alice"}}
	verify := func(_ context.Context, token string) (identity.Claims, error) {
		if token != "valid" {
			return identity.Claims{}, errors.New("invalid token")
		}
		return identity.Claims{Subject: "alice-subject", Username: "alice", Name: "Alice"}, nil
	}
	key := []byte(strings.Repeat("k", 32))
	deps := FluoDependencies{Store: store, Media: mediaStub{valid: false}, MediaBaseURL: "http://localhost:8082", MediaSignKey: key}
	id := "01999111-2222-7333-8444-555555555551"
	requestBody := `{"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello"}]}]},"visibility":"public","attachmentIds":["` + id + `"]}`
	invoke := func(body, bearer string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(http.MethodPost, "/v1/fluo/posts", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if bearer != "" {
			r.Header.Set("Authorization", "Bearer "+bearer)
		}
		w := httptest.NewRecorder()
		NewRouterWithFluo(verify, users, deps, nil).ServeHTTP(w, r)
		return w
	}
	if response := invoke(requestBody, ""); response.Code != http.StatusUnauthorized || store.created != 0 {
		t.Fatalf("unauthorized create = %d, writes %d", response.Code, store.created)
	}
	bad := `{"content":{"type":"doc","content":[{"type":"heading"}]},"visibility":"public"}`
	if response := invoke(bad, "valid"); response.Code != http.StatusBadRequest || store.created != 0 {
		t.Fatalf("invalid rich text = %d, writes %d", response.Code, store.created)
	}
	if response := invoke(requestBody, "valid"); response.Code != http.StatusBadRequest || store.created != 0 {
		t.Fatalf("unowned media = %d, writes %d", response.Code, store.created)
	}
	deps.Media = mediaStub{valid: true}
	response := invoke(requestBody, "valid")
	if response.Code != http.StatusCreated || store.created != 1 || len(store.lastMedia) != 1 {
		t.Fatalf("owned media create = %d, writes %d: %s", response.Code, store.created, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("post response can be cached")
	}
	var post fluo.Post
	if err := json.Unmarshal(response.Body.Bytes(), &post); err != nil {
		t.Fatal(err)
	}
	if len(post.Media) != 1 || post.Media[0].URL == "" {
		t.Fatalf("media URL missing: %+v", post.Media)
	}
	mediaURL, err := url.Parse(post.Media[0].URL)
	if err != nil || !mediaauth.Verify(id, mediaURL.Query().Get("exp"), mediaURL.Query().Get("sig"), key, time.Now()) {
		t.Fatal("media URL is not correctly signed")
	}
}

func TestInternalMediaReferenceRequiresServiceToken(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	handler := NewRouterWithFluo(func(context.Context, string) (identity.Claims, error) {
		t.Fatal("user token verifier should not run on an internal reference check")
		return identity.Claims{}, nil
	}, &fakeUsers{}, FluoDependencies{Store: &fluoStoreStub{}, MediaSignKey: key}, nil)
	path := "/v1/internal/media/01999111-2222-7333-8444-555555555551/referenced"
	for _, candidate := range []struct {
		token  string
		status int
	}{
		{"", http.StatusForbidden}, {"invalid", http.StatusForbidden},
		{mediaauth.InternalToken(key), http.StatusOK},
	} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.Header.Set("X-Kaordo-Internal-Token", candidate.token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != candidate.status {
			t.Fatalf("internal access = %d, want %d", response.Code, candidate.status)
		}
	}
}
