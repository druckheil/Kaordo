package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
)

type ligoStoreStub struct {
	ligo.Store
	sends   int
	created []ligo.NewConversation
}

func (store *ligoStoreStub) CreateConversation(_ context.Context, actor string, input ligo.NewConversation) (ligo.Conversation, error) {
	store.created = append(store.created, input)
	return ligo.Conversation{ID: "01999111-2222-7333-8444-555555555555", Kind: input.Kind,
		CreatedBy: actor, Members: []ligo.User{{ID: actor}}, CreatedAt: time.Now(), UpdatedAt: time.Now()}, nil
}

func TestLigoSelfConversationValidation(t *testing.T) {
	store := &ligoStoreStub{}
	users := &fakeUsers{user: account.User{ID: "01999111-2222-7333-8444-555555555554"}}
	verify := func(_ context.Context, _ string) (identity.Claims, error) {
		return identity.Claims{Subject: "alice"}, nil
	}
	call := func(body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/v1/ligo/conversations", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer valid")
		response := httptest.NewRecorder()
		NewRouter(verify, users, Modules{Fluo: FluoDependencies{}, Ligo: LigoDependencies{Store: store}}, nil).ServeHTTP(response, request)
		return response
	}
	if response := call(`{"kind":"self","participantIds":[]}`); response.Code != http.StatusCreated || len(store.created) != 1 {
		t.Fatalf("private notes = %d, %s", response.Code, response.Body.String())
	}
	if response := call(`{"kind":"self","participantIds":["01999111-2222-7333-8444-555555555559"]}`); response.Code != http.StatusBadRequest || len(store.created) != 1 {
		t.Fatalf("self conversation with another user = %d, %s", response.Code, response.Body.String())
	}
}

func (store *ligoStoreStub) Send(_ context.Context, actor, conversationID string, input ligo.NewMessage, media []ligo.Media) (ligo.Message, error) {
	store.sends++
	return ligo.Message{
		ID: "01999111-2222-7333-8444-555555555599", ConversationID: conversationID,
		ClientID: input.ClientID, Sender: ligo.User{ID: actor, Username: "alice", DisplayName: "Alice"},
		Text: input.Text, Media: media, CreatedAt: time.Now(),
	}, nil
}

type ligoMediaStub struct{ valid bool }

func (ligoMediaStub) Purge(context.Context, string) error { return nil }

func (stub ligoMediaStub) ValidateLigo(_ context.Context, _, id string) (ligo.Media, error) {
	if !stub.valid {
		return ligo.Media{}, errors.New("not owned")
	}
	return ligo.Media{ID: id, Kind: "file", MimeType: "application/octet-stream",
		Filename: "notes.pdf", Size: 100}, nil
}

func TestLigoSendValidatesAccountAndAttachmentOwnership(t *testing.T) {
	store := &ligoStoreStub{}
	users := &fakeUsers{user: account.User{
		ID: "01999111-2222-7333-8444-555555555554", Username: "alice", DisplayName: "Alice",
	}}
	verify := func(_ context.Context, token string) (identity.Claims, error) {
		if token != "valid" {
			return identity.Claims{}, errors.New("invalid")
		}
		return identity.Claims{Subject: "alice-subject", Username: "alice", Name: "Alice"}, nil
	}
	id := "01999111-2222-7333-8444-555555555555"
	uploadID := "01999111-2222-7333-8444-555555555556"
	body := `{"clientId":"01999111-2222-7333-8444-555555555557","text":"hello","attachmentIds":["` + uploadID + `"],"altTexts":{"` + uploadID + `":"Lecture notes"}}`
	call := func(token string, validMedia bool) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "/v1/ligo/conversations/"+id+"/messages", strings.NewReader(body))
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response := httptest.NewRecorder()
		NewRouter(verify, users, Modules{Fluo: FluoDependencies{}, Ligo: LigoDependencies{
			Store: store, Media: ligoMediaStub{valid: validMedia},
			MediaBaseURL: "http://localhost:8082", MediaSignKey: []byte(strings.Repeat("k", 32)),
		}}, nil).ServeHTTP(response, request)
		return response
	}
	if response := call("", true); response.Code != http.StatusUnauthorized || store.sends != 0 {
		t.Fatalf("anonymous send = %d, sends = %d", response.Code, store.sends)
	}
	if response := call("valid", false); response.Code != http.StatusBadRequest || store.sends != 0 {
		t.Fatalf("unowned file accepted = %d, sends = %d", response.Code, store.sends)
	}
	response := call("valid", true)
	if response.Code != http.StatusCreated || store.sends != 1 ||
		!strings.Contains(response.Body.String(), "notes.pdf") ||
		!strings.Contains(response.Body.String(), "Lecture notes") ||
		!strings.Contains(response.Body.String(), "/v1/media/"+uploadID) ||
		response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("valid send = %d, %s", response.Code, response.Body.String())
	}
}

func TestLigoSendAcceptsEightAttachmentsAndRejectsNine(t *testing.T) {
	store := &ligoStoreStub{}
	users := &fakeUsers{user: account.User{ID: "01999111-2222-7333-8444-555555555554"}}
	verify := func(_ context.Context, _ string) (identity.Claims, error) {
		return identity.Claims{Subject: "alice"}, nil
	}
	ids := make([]string, 9)
	for index := range ids {
		ids[index] = fmt.Sprintf("01999111-2222-7333-8444-%012d", index+700)
	}
	call := func(selected []string) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(ligo.NewMessage{
			ClientID: "01999111-2222-7333-8444-555555555557", AttachmentIDs: selected,
		})
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost,
			"/v1/ligo/conversations/01999111-2222-7333-8444-555555555555/messages", strings.NewReader(string(body)))
		request.Header.Set("Authorization", "Bearer valid")
		response := httptest.NewRecorder()
		NewRouter(verify, users, Modules{Fluo: FluoDependencies{}, Ligo: LigoDependencies{
			Store: store, Media: ligoMediaStub{valid: true},
			MediaBaseURL: "http://localhost:8082", MediaSignKey: []byte(strings.Repeat("k", 32)),
		}}, nil).ServeHTTP(response, request)
		return response
	}
	if response := call(ids); response.Code != http.StatusBadRequest || store.sends != 0 {
		t.Fatalf("nine attachments = %d, sends = %d", response.Code, store.sends)
	}
	if response := call(ids[:8]); response.Code != http.StatusCreated || store.sends != 1 {
		t.Fatalf("eight attachments = %d, %s", response.Code, response.Body.String())
	}
}

type eventStub struct {
	userID string
	ch     chan string
}

func (stub *eventStub) Subscribe(userID string) (<-chan string, func()) {
	stub.userID = userID
	return stub.ch, func() {}
}

func TestLigoEventStreamIsAuthenticatedAndUserScoped(t *testing.T) {
	id := "01999111-2222-7333-8444-555555555554"
	users := &fakeUsers{user: account.User{ID: id, Username: "alice", DisplayName: "Alice"}}
	verify := func(_ context.Context, token string) (identity.Claims, error) {
		if token != "valid" {
			return identity.Claims{}, errors.New("invalid")
		}
		return identity.Claims{Subject: "alice-subject", Username: "alice"}, nil
	}
	events := &eventStub{ch: make(chan string, 1)}
	server := httptest.NewServer(NewRouter(verify, users, Modules{Fluo: FluoDependencies{}, Ligo: LigoDependencies{Store: &ligoStoreStub{}, Events: events}}, nil))
	defer server.Close()
	anonymous, err := http.Get(server.URL + "/v1/ligo/events")
	if err != nil {
		t.Fatal(err)
	}
	anonymous.Body.Close()
	if anonymous.StatusCode != http.StatusUnauthorized || events.userID != "" {
		t.Fatalf("anonymous stream = %d, subscriber = %q", anonymous.StatusCode, events.userID)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/v1/ligo/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer valid")
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Content-Type") != "text/event-stream" || events.userID != id {
		t.Fatalf("stream = %d, %q, subscriber = %q", response.StatusCode, response.Header.Get("Content-Type"), events.userID)
	}
	reader := bufio.NewReader(response.Body)
	line, err := reader.ReadString('\n')
	if err != nil || line != "event: ready\n" {
		t.Fatalf("ready event = %q, %v", line, err)
	}
	events.ch <- "01999111-2222-7333-8444-555555555555"
	for {
		line, err = reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(line, "event: update") {
			break
		}
	}
	line, err = reader.ReadString('\n')
	if err != nil || !strings.Contains(line, "conversationId") {
		t.Fatalf("update = %q, %v", line, err)
	}
}
