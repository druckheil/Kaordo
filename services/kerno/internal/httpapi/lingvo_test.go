package httpapi

// Checks authenticated Lingvo routing, bounded filters and safe error contracts without database fixtures
import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
	"github.com/druckheil/Kaordo/services/kerno/internal/lingvo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
)

const lingvoResourceID = "01999abc-1234-7000-8000-000000000001"

type lingvoRouteStore struct {
	lingvo.Store
	actor  string
	filter lingvo.CardFilter
	calls  int
	err    error
}

func (store *lingvoRouteStore) Dictionaries(_ context.Context, actor string) ([]lingvo.Dictionary, error) {
	store.actor, store.calls = actor, store.calls+1
	return []lingvo.Dictionary{}, store.err
}

func (store *lingvoRouteStore) Cards(_ context.Context, actor, _ string, filter lingvo.CardFilter) (lingvo.CardPage, error) {
	store.actor, store.calls, store.filter = actor, store.calls+1, filter
	return lingvo.CardPage{Items: []lingvo.Card{}}, store.err
}

func lingvoRouter(store *lingvoRouteStore, user postgres.User) http.Handler {
	return NewRouterWithServices(func(_ context.Context, token string) (identity.Claims, error) {
		if token != "valid" {
			return identity.Claims{}, errors.New("invalid synthetic token")
		}
		return identity.Claims{Subject: "subject", Username: "learner"}, nil
	}, &fakeUsers{user: user}, Modules{Lingvo: LingvoDependencies{Store: store}}, nil)
}

func lingvoRequest(handler http.Handler, method, path, body, authorization string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", authorization)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestLingvoEveryRouteRequiresAuthentication(t *testing.T) {
	store := &lingvoRouteStore{}
	handler := lingvoRouter(store, postgres.User{ID: lingvoResourceID})
	dictionary := "/v1/lingvo/dictionaries/" + lingvoResourceID
	for _, route := range []struct{ method, path string }{
		{"GET", "/v1/lingvo/catalog?nativeLanguage=en"}, {"GET", "/v1/lingvo/dictionaries"}, {"POST", "/v1/lingvo/dictionaries"},
		{"GET", dictionary}, {"PUT", dictionary + "/settings"}, {"GET", dictionary + "/cards"}, {"POST", dictionary + "/cards"},
		{"PUT", dictionary + "/cards/" + lingvoResourceID}, {"DELETE", dictionary + "/cards/" + lingvoResourceID},
		{"GET", dictionary + "/study"}, {"POST", dictionary + "/cards/" + lingvoResourceID + "/reviews"},
		{"POST", dictionary + "/reviews/" + lingvoResourceID + "/undo"}, {"POST", dictionary + "/folders"},
		{"DELETE", dictionary + "/folders/" + lingvoResourceID}, {"POST", dictionary + "/imports"},
	} {
		for _, token := range []string{"", "Bearer invalid"} {
			response := lingvoRequest(handler, route.method, route.path, "{}", token)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("%s %s: %d", route.method, route.path, response.Code)
			}
		}
	}
	if store.calls != 0 {
		t.Fatal("unauthenticated requests reached the store")
	}
}

func TestLingvoIdentityAndResourceBoundaries(t *testing.T) {
	store := &lingvoRouteStore{}
	for _, scenario := range []struct {
		user   postgres.User
		status int
	}{{postgres.User{}, 409}, {postgres.User{ID: lingvoResourceID, DisabledAt: timePointer(time.Now())}, 403}} {
		response := lingvoRequest(lingvoRouter(store, scenario.user), "GET", "/v1/lingvo/dictionaries", "", "Bearer valid")
		if response.Code != scenario.status {
			t.Fatalf("unavailable actor = %d", response.Code)
		}
	}
	handler := lingvoRouter(store, postgres.User{ID: lingvoResourceID})
	for _, route := range []struct{ method, path string }{{"GET", "/v1/lingvo/dictionaries/not-an-id/cards"}, {"PUT", "/v1/lingvo/dictionaries/" + lingvoResourceID + "/cards/not-an-id"}, {"DELETE", "/v1/lingvo/dictionaries/" + lingvoResourceID + "/folders/not-an-id"}, {"POST", "/v1/lingvo/dictionaries/" + lingvoResourceID + "/reviews/not-an-id/undo"}} {
		response := lingvoRequest(handler, route.method, route.path, "", "Bearer valid")
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid resource = %d", response.Code)
		}
	}
	response := lingvoRequest(handler, "GET", "/v1/lingvo/dictionaries", "", "Bearer valid")
	if response.Code != http.StatusOK || store.actor != lingvoResourceID || store.calls != 1 {
		t.Fatalf("owner routing = %d, %+v", response.Code, store)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("private dictionary response may be cached")
	}
}

func timePointer(value time.Time) *time.Time { return &value }

func TestLingvoFiltersAndBodiesRejectInvalidInputBeforeStore(t *testing.T) {
	store := &lingvoRouteStore{}
	handler := lingvoRouter(store, postgres.User{ID: lingvoResourceID})
	base := "/v1/lingvo/dictionaries/" + lingvoResourceID
	for _, query := range []string{"kind=other", "status=other", "folder=invalid", "limit=0", "limit=201", "offset=-1", "offset=10001", "limit=1.5", "q=%00", "q=" + strings.Repeat("x", 101)} {
		response := lingvoRequest(handler, "GET", base+"/cards?"+query, "", "Bearer valid")
		if response.Code != http.StatusBadRequest {
			t.Fatalf("filter %q = %d", query, response.Code)
		}
	}
	for _, request := range []struct{ method, path, body string }{
		{"POST", base + "/cards", `{"unexpected":"field"}`}, {"POST", base + "/cards", "{} {}"},
		{"POST", base + "/cards", `{"term":42}`}, {"POST", base + "/cards", "{"},
		{"PUT", base + "/cards/" + lingvoResourceID, `{"revision":0}`},
		{"DELETE", base + "/cards/" + lingvoResourceID + "?revision=-1", ""},
		{"GET", base + "/study", ""}, {"POST", base + "/imports", `{"cards":[],"padding":"` + strings.Repeat("a", 1<<20) + `"}`},
	} {
		response := lingvoRequest(handler, request.method, request.path, request.body, "Bearer valid")
		if response.Code != http.StatusBadRequest && response.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("invalid %s %s = %d", request.method, request.path, response.Code)
		}
	}
	if store.calls != 0 {
		t.Fatal("invalid request reached the store")
	}
	response := lingvoRequest(handler, "GET", base+"/cards?kind=word&status=active&folder=none&offset=3&limit=200&q=%20Haus%20", "", "Bearer valid")
	if response.Code != http.StatusOK || store.filter != (lingvo.CardFilter{Kind: "word", Status: "active", FolderID: "none", Offset: 3, Limit: 200, Search: "Haus"}) {
		t.Fatalf("filter forwarding = %d, %+v", response.Code, store.filter)
	}
}

func TestLingvoSafeErrorStatusContract(t *testing.T) {
	for _, scenario := range []struct {
		err    error
		status int
	}{
		{lingvo.ErrNotFound, 404}, {lingvo.ErrInvalid, 400}, {fmt.Errorf("%w: Choose a valid card.", lingvo.ErrInvalid), 400},
		{lingvo.ErrConflict, 409}, {lingvo.ErrExists, 409}, {lingvo.ErrLimit, 409}, {errors.New("private database diagnostic"), 500},
	} {
		response := httptest.NewRecorder()
		lingvoResponse(response, http.StatusOK, nil, scenario.err)
		if response.Code != scenario.status || strings.Contains(response.Body.String(), "private") {
			t.Fatalf("error = %d %s", response.Code, response.Body.String())
		}
	}
	response := httptest.NewRecorder()
	lingvoResponse(response, http.StatusNoContent, nil, nil)
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatal("delete returned a payload")
	}
}
