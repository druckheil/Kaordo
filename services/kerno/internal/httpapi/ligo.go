package httpapi

// Handles Ligo conversation, message, media, receipt, and event requests
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
	"github.com/druckheil/Kaordo/services/mediaauth"
	"github.com/go-chi/chi/v5"
)

type LigoEvents interface {
	Subscribe(userID string) (<-chan string, func())
}

type LigoMediaVerifier interface {
	ValidateLigo(context.Context, string, string) (ligo.Media, error)
	Purge(context.Context, string) error
}

type LigoDependencies struct {
	Store        ligo.Store
	Events       LigoEvents
	Media        LigoMediaVerifier
	MediaBaseURL string
	MediaSignKey []byte
}

type ligoHandler struct {
	verify VerifyFunc
	users  UserStore
	deps   LigoDependencies
}

const maxLigoAttachments = 8

func mountLigo(router chi.Router, verify VerifyFunc, users UserStore, deps LigoDependencies) {
	h := ligoHandler{verify: verify, users: users, deps: deps}
	router.Route("/v1/ligo", func(r chi.Router) {
		r.Get("/users", h.searchUsers)
		r.Get("/conversations", h.listConversations)
		r.Post("/conversations", h.createConversation)
		r.Get("/conversations/{id}", h.getConversation)
		r.Post("/conversations/{id}/members", h.addMembers)
		r.Get("/conversations/{id}/messages", h.listMessages)
		r.Post("/conversations/{id}/messages", h.send)
		r.Patch("/conversations/{id}/messages/{messageId}", h.editMessage)
		r.Delete("/conversations/{id}/messages/{messageId}", h.deleteMessage)
		r.Put("/conversations/{id}/messages/{messageId}/reaction", h.setReaction)
		r.Put("/conversations/{id}/delivered", h.markDelivered)
		r.Put("/conversations/{id}/read", h.markRead)
		r.Get("/events", h.events)
	})
}

func (h ligoHandler) actor(w http.ResponseWriter, r *http.Request) (postgres.User, bool) {
	return authenticatedActor(w, r, h.verify, h.users, "Start a Kaordo account session before using Ligo.")
}

func ligoError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ligo.ErrNotFound):
		writeError(w, http.StatusNotFound, "Conversation or account not found.")
	case errors.Is(err, ligo.ErrForbidden):
		writeError(w, http.StatusForbidden, "You cannot change this conversation.")
	case errors.Is(err, ligo.ErrInvalid):
		writeError(w, http.StatusBadRequest, "Invalid conversation request.")
	case errors.Is(err, ligo.ErrMediaOwner):
		writeError(w, http.StatusBadRequest, "An attachment is unavailable or not yours.")
	case errors.Is(err, ligo.ErrRateLimited):
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "Sending too quickly. Try again in a minute.")
	default:
		writeError(w, http.StatusInternalServerError, "Ligo could not complete the request.")
	}
}

func ligoID(id string) bool { return fluo.ValidID(id) }

func validIDs(ids []string, maximum int) bool {
	if len(ids) == 0 || len(ids) > maximum {
		return false
	}
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if !ligoID(id) {
			return false
		}
		if _, duplicate := seen[id]; duplicate {
			return false
		}
		seen[id] = struct{}{}
	}
	return true
}

func (h ligoHandler) searchUsers(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(search) < 2 || utf8.RuneCountInString(search) > 50 {
		writeError(w, http.StatusBadRequest, "Search must contain 2 to 50 characters.")
		return
	}
	users, err := h.deps.Store.SearchUsers(r.Context(), actor.ID, search)
	if err != nil {
		ligoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": users})
}

func (h ligoHandler) decorate(message *ligo.Message) error {
	for index := range message.Media {
		url, err := mediaauth.SignedURL(h.deps.MediaBaseURL, message.Media[index].ID,
			time.Now().Add(9*time.Minute), h.deps.MediaSignKey)
		if err != nil {
			return err
		}
		message.Media[index].URL = url
	}
	return nil
}

func (h ligoHandler) listConversations(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	cursor, err := ligo.DecodeConversationCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid conversation cursor.")
		return
	}
	limit, ok := parseLigoPageLimit(w, r.URL.Query().Get("limit"))
	if !ok {
		return
	}
	page, err := h.deps.Store.ListConversations(r.Context(), actor.ID, cursor, limit)
	if err != nil {
		ligoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func parseLigoPageLimit(w http.ResponseWriter, raw string) (int, bool) {
	if raw == "" {
		return 30, true
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 50 {
		writeError(w, http.StatusBadRequest, "Limit must be between 1 and 50.")
		return 0, false
	}
	return limit, true
}

func (h ligoHandler) getConversation(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !ligoID(id) {
		writeError(w, http.StatusBadRequest, "Invalid conversation ID.")
		return
	}
	item, err := h.deps.Store.GetConversation(r.Context(), actor.ID, id)
	if err != nil {
		ligoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h ligoHandler) createConversation(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input ligo.NewConversation
	if !decodeBody(w, r, &input) {
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	if !validNewConversation(input) {
		writeError(w, http.StatusBadRequest, "Choose a private note, one person for a direct chat, or a title and up to 24 people for a group.")
		return
	}
	if slices.Contains(input.ParticipantIDs, actor.ID) {
		writeError(w, http.StatusBadRequest, "You are already a participant.")
		return
	}
	item, err := h.deps.Store.CreateConversation(r.Context(), actor.ID, input)
	if err != nil {
		ligoError(w, err)
		return
	}
	w.Header().Set("Location", "/v1/ligo/conversations/"+item.ID)
	writeJSON(w, http.StatusCreated, item)
}

func validNewConversation(input ligo.NewConversation) bool {
	return validConversationKind(input) && validConversationParticipants(input)
}

func validConversationKind(input ligo.NewConversation) bool {
	switch input.Kind {
	case "self":
		return len(input.ParticipantIDs) == 0 && input.Title == ""
	case "duo":
		return len(input.ParticipantIDs) == 1 && input.Title == ""
	case "group":
		titleLength := utf8.RuneCountInString(input.Title)
		return titleLength >= 1 && titleLength <= 100
	default:
		return false
	}
}

func validConversationParticipants(input ligo.NewConversation) bool {
	if input.Kind == "self" {
		return true
	}
	return validIDs(input.ParticipantIDs, 24)
}

func (h ligoHandler) addMembers(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !ligoID(id) {
		writeError(w, http.StatusBadRequest, "Invalid conversation ID.")
		return
	}
	var input struct {
		ParticipantIDs []string `json:"participantIds"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	if !validIDs(input.ParticipantIDs, 24) {
		writeError(w, http.StatusBadRequest, "Choose 1 to 24 distinct accounts.")
		return
	}
	item, err := h.deps.Store.AddMembers(r.Context(), actor.ID, id, input.ParticipantIDs)
	if err != nil {
		ligoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h ligoHandler) listMessages(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !ligoID(id) {
		writeError(w, http.StatusBadRequest, "Invalid conversation ID.")
		return
	}
	before := r.URL.Query().Get("before")
	if before != "" && !ligoID(before) {
		writeError(w, http.StatusBadRequest, "Invalid message cursor.")
		return
	}
	limit, ok := parseLigoPageLimit(w, r.URL.Query().Get("limit"))
	if !ok {
		return
	}
	page, err := h.deps.Store.ListMessages(r.Context(), actor.ID, id, before, limit)
	if err != nil {
		ligoError(w, err)
		return
	}
	for index := range page.Items {
		if err := h.decorate(&page.Items[index]); err != nil {
			ligoError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, page)
}

func (h ligoHandler) send(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !ligoID(id) {
		writeError(w, http.StatusBadRequest, "Invalid conversation ID.")
		return
	}
	var input ligo.NewMessage
	if !decodeBody(w, r, &input) {
		return
	}
	input.Text = strings.TrimSpace(input.Text)
	if !validNewMessage(input) {
		writeError(w, http.StatusBadRequest, "Write up to 4,000 characters or attach up to eight files.")
		return
	}
	media, ok := h.validateMessageMedia(w, r, input)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	message, err := h.deps.Store.Send(ctx, actor.ID, id, input, media)
	if err != nil {
		ligoError(w, err)
		return
	}
	if err := h.decorate(&message); err != nil {
		ligoError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, message)
}

func validNewMessage(input ligo.NewMessage) bool {
	return ligoID(input.ClientID) &&
		utf8.RuneCountInString(input.Text) <= 4000 &&
		!strings.ContainsRune(input.Text, 0) &&
		len(input.AttachmentIDs) <= maxLigoAttachments &&
		(input.Text != "" || len(input.AttachmentIDs) != 0)
}

func (h ligoHandler) validateMessageMedia(w http.ResponseWriter, r *http.Request, input ligo.NewMessage) ([]ligo.Media, bool) {
	seen := make(map[string]struct{}, len(input.AttachmentIDs))
	media := make([]ligo.Media, 0, len(input.AttachmentIDs))
	for _, uploadID := range input.AttachmentIDs {
		item, ok := h.validateMessageAttachment(w, r, uploadID, input.AltTexts[uploadID], seen)
		if !ok {
			return nil, false
		}
		media = append(media, item)
	}
	for uploadID := range input.AltTexts {
		if _, attached := seen[uploadID]; !attached {
			writeError(w, http.StatusBadRequest, "Alt text must belong to an attached file.")
			return nil, false
		}
	}
	return media, true
}

func (h ligoHandler) validateMessageAttachment(w http.ResponseWriter, r *http.Request, uploadID, altText string, seen map[string]struct{}) (ligo.Media, bool) {
	if !ligoID(uploadID) {
		writeError(w, http.StatusBadRequest, "Attachment IDs must be unique UUIDs.")
		return ligo.Media{}, false
	}
	if _, duplicate := seen[uploadID]; duplicate {
		writeError(w, http.StatusBadRequest, "Attachment IDs must be unique UUIDs.")
		return ligo.Media{}, false
	}
	seen[uploadID] = struct{}{}
	altText = strings.TrimSpace(altText)
	if utf8.RuneCountInString(altText) > 500 || strings.ContainsRune(altText, 0) {
		writeError(w, http.StatusBadRequest, "Alt text must be 500 characters or fewer.")
		return ligo.Media{}, false
	}
	if h.deps.Media == nil {
		writeError(w, http.StatusServiceUnavailable, "Media storage is unavailable.")
		return ligo.Media{}, false
	}
	item, err := h.deps.Media.ValidateLigo(r.Context(), r.Header.Get("Authorization"), uploadID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "An attachment is unavailable or not yours.")
		return ligo.Media{}, false
	}
	item.AltText = altText
	return item, true
}

func (h ligoHandler) editMessage(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	conversationID, messageID := chi.URLParam(r, "id"), chi.URLParam(r, "messageId")
	if !ligoID(conversationID) || !ligoID(messageID) {
		writeError(w, http.StatusBadRequest, "Invalid conversation or message ID.")
		return
	}
	var input struct {
		Text string `json:"text"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	input.Text = strings.TrimSpace(input.Text)
	if utf8.RuneCountInString(input.Text) > 4000 || strings.ContainsRune(input.Text, 0) {
		writeError(w, http.StatusBadRequest, "A message can contain up to 4,000 characters.")
		return
	}
	message, err := h.deps.Store.Edit(r.Context(), actor.ID, conversationID, messageID, input.Text)
	if err != nil {
		ligoError(w, err)
		return
	}
	if err := h.decorate(&message); err != nil {
		ligoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, message)
}

func (h ligoHandler) deleteMessage(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	conversationID, messageID := chi.URLParam(r, "id"), chi.URLParam(r, "messageId")
	if !ligoID(conversationID) || !ligoID(messageID) {
		writeError(w, http.StatusBadRequest, "Invalid conversation or message ID.")
		return
	}
	retired, err := h.deps.Store.DeleteMessage(r.Context(), actor.ID, conversationID, messageID)
	if err != nil {
		ligoError(w, err)
		return
	}
	if h.deps.Media != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		for _, id := range retired {
			if err := h.deps.Media.Purge(ctx, id); err != nil {
				log.Printf("Kerno deferred Ligo media cleanup for %s: %v", id, err)
				break
			}
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (h ligoHandler) setReaction(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	conversationID, messageID := chi.URLParam(r, "id"), chi.URLParam(r, "messageId")
	if !ligoID(conversationID) || !ligoID(messageID) {
		writeError(w, http.StatusBadRequest, "Invalid conversation or message ID.")
		return
	}
	var input struct {
		Emoji  string `json:"emoji"`
		Active *bool  `json:"active"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	if input.Active == nil || (input.Emoji != "❤️" && input.Emoji != "👍" && input.Emoji != "👎") {
		writeError(w, http.StatusBadRequest, "Choose a heart, like or dislike reaction.")
		return
	}
	message, err := h.deps.Store.SetReaction(r.Context(), actor.ID, conversationID, messageID, input.Emoji, *input.Active)
	if err != nil {
		ligoError(w, err)
		return
	}
	if err := h.decorate(&message); err != nil {
		ligoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, message)
}

func (h ligoHandler) markDelivered(w http.ResponseWriter, r *http.Request) {
	h.markReceipt(w, r, false)
}

func (h ligoHandler) markRead(w http.ResponseWriter, r *http.Request) {
	h.markReceipt(w, r, true)
}

func (h ligoHandler) markReceipt(w http.ResponseWriter, r *http.Request, read bool) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	var input struct {
		MessageID string `json:"messageId"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	if !ligoID(id) || !ligoID(input.MessageID) {
		writeError(w, http.StatusBadRequest, "Invalid conversation or message ID.")
		return
	}
	var err error
	if read {
		err = h.deps.Store.MarkRead(r.Context(), actor.ID, id, input.MessageID)
	} else {
		err = h.deps.Store.MarkDelivered(r.Context(), actor.ID, id, input.MessageID)
	}
	if err != nil {
		ligoError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (h ligoHandler) events(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	if h.deps.Events == nil {
		writeError(w, http.StatusServiceUnavailable, "Live updates are unavailable.")
		return
	}
	h.serveEvents(w, r, actor.ID)
}

func (h ligoHandler) serveEvents(w http.ResponseWriter, r *http.Request, userID string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")
	ch, unsubscribe := h.deps.Events.Subscribe(userID)
	defer unsubscribe()
	_, _ = fmt.Fprint(w, "event: ready\ndata: {}\n\n")
	controller := http.NewResponseController(w)
	if controller.Flush() != nil {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	rotate := time.NewTimer(45 * time.Second)
	defer rotate.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-rotate.C:
			return // reconnect with a fresh access token
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": heartbeat\n\n")
		case id, open := <-ch:
			if !open {
				return
			}
			writeLigoActivityEvent(w, id)
		}
		if controller.Flush() != nil {
			return
		}
	}
}

func writeLigoActivityEvent(w http.ResponseWriter, conversationID string) {
	if conversationID == "" {
		_, _ = fmt.Fprint(w, "event: resync\ndata: {}\n\n")
		return
	}
	data, _ := json.Marshal(map[string]string{"conversationId": conversationID})
	_, _ = fmt.Fprintf(w, "event: update\ndata: %s\n\n", data)
}
