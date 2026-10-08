package httpapi

// Handles Ligo conversation discovery, creation and membership
import (
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/go-chi/chi/v5"
)

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
