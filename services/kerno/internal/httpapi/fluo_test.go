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
	saved     map[string]bool
	lastList  fluo.ListOptions
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
func (store *fluoStoreStub) Thread(context.Context, string, string) (fluo.Thread, error) {
	return fluo.Thread{}, fluo.ErrNotFound
}
func (store *fluoStoreStub) SetVisibility(context.Context, string, string, string) error {
	return fluo.ErrNotFound
}
func (store *fluoStoreStub) List(_ context.Context, options fluo.ListOptions) (fluo.Page, error) {
	store.listed++
	store.lastList = options
	return fluo.Page{Items: []fluo.Post{}}, nil
}
func (store *fluoStoreStub) Delete(context.Context, string, string) ([]string, error) {
	return nil, fluo.ErrNotFound
}
func (store *fluoStoreStub) MediaReferenced(context.Context, string) (bool, error) { return false, nil }
func (store *fluoStoreStub) SetSaved(_ context.Context, userID, postID string, saved bool) error {
	if store.saved == nil {
		store.saved = make(map[string]bool)
	}
	store.saved[userID+":"+postID] = saved
	return nil
}
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
	requestBody := `{"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello"}]}]},"visibility":"public","attachmentIds":["` + id + `"],"altTexts":{"` + id + `":"A dark square"}}`
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
	if post.Media[0].AltText != "A dark square" {
		t.Fatalf("media description missing: %+v", post.Media)
	}
	mediaURL, err := url.Parse(post.Media[0].URL)
	if err != nil || !mediaauth.Verify(id, mediaURL.Query().Get("exp"), mediaURL.Query().Get("sig"), key, time.Now()) {
		t.Fatal("media URL is not correctly signed")
	}
	quoted := fluo.Post{Quote: &fluo.Quote{Media: []fluo.Media{{ID: id}}}}
	if err := (fluoHandler{deps: deps}).decorate(&quoted); err != nil {
		t.Fatal(err)
	}
	quotedURL, err := url.Parse(quoted.Quote.Media[0].URL)
	if err != nil || !mediaauth.Verify(id, quotedURL.Query().Get("exp"), quotedURL.Query().Get("sig"), key, time.Now()) {
		t.Fatal("quoted media URL is not correctly signed")
	}
	reused := invoke(strings.Replace(requestBody, "A dark square", "The same image in another context", 1), "valid")
	if reused.Code != http.StatusCreated || store.created != 2 || len(store.lastMedia) != 1 || store.lastMedia[0].ID != id ||
		store.lastMedia[0].AltText != "The same image in another context" {
		t.Fatalf("reused owned media = %d, writes %d: %s", reused.Code, store.created, reused.Body.String())
	}
	tooLong := strings.Replace(requestBody, "A dark square", strings.Repeat("a", 501), 1)
	if response := invoke(tooLong, "valid"); response.Code != http.StatusBadRequest || store.created != 2 {
		t.Fatalf("overlong alt text = %d, writes %d", response.Code, store.created)
	}
}

func TestSavedPostRoutesAndSearchQuery(t *testing.T) {
	store := &fluoStoreStub{}
	users := &fakeUsers{user: postgres.User{ID: "01999111-2222-7333-8444-555555555554", Username: "alice", DisplayName: "Alice"}}
	verify := func(_ context.Context, token string) (identity.Claims, error) {
		if token != "valid" {
			return identity.Claims{}, errors.New("invalid token")
		}
		return identity.Claims{Subject: "alice-subject", Username: "alice", Name: "Alice"}, nil
	}
	handler := NewRouterWithFluo(verify, users, FluoDependencies{Store: store}, nil)
	postID := "01999111-2222-7333-8444-555555555551"

	request := func(method, path, bearer string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		if bearer != "" {
			r.Header.Set("Authorization", "Bearer "+bearer)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if response := request(http.MethodPut, "/v1/fluo/posts/"+postID+"/saved", ""); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated save = %d", response.Code)
	}
	if response := request(http.MethodPut, "/v1/fluo/posts/"+postID+"/saved", "valid"); response.Code != http.StatusNoContent || !store.saved[users.user.ID+":"+postID] {
		t.Fatalf("save post = %d, saved %t", response.Code, store.saved[users.user.ID+":"+postID])
	}
	if response := request(http.MethodGet, "/v1/fluo/posts?feed=saved", "valid"); response.Code != http.StatusOK || store.lastList.Feed != "saved" {
		t.Fatalf("saved list = %d, feed %q", response.Code, store.lastList.Feed)
	}
	if response := request(http.MethodGet, "/v1/fluo/posts?q=blue%20bird", "valid"); response.Code != http.StatusOK || store.lastList.Search != "blue bird" {
		t.Fatalf("search posts = %d, term %q", response.Code, store.lastList.Search)
	}
	if response := request(http.MethodDelete, "/v1/fluo/posts/"+postID+"/saved", "valid"); response.Code != http.StatusNoContent || store.saved[users.user.ID+":"+postID] {
		t.Fatalf("unsave post = %d, saved %t", response.Code, store.saved[users.user.ID+":"+postID])
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
