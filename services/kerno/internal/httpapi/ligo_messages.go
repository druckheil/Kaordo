package httpapi

// Coordinates Ligo message reads, sends and changes
import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/go-chi/chi/v5"
)

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
