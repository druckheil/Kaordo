package httpapi

// Coordinates Fluo post creation, visibility and deletion
import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/go-chi/chi/v5"
)

func (h fluoHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input fluo.NewPost
	if !decodeBodyLimit(w, r, &input, 1<<20) {
		return
	}
	text, ok := validatePostInput(w, &input)
	if !ok {
		return
	}
	media, ok := h.validatePostMedia(w, r, input)
	if !ok {
		return
	}
	createCtx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	post, err := h.deps.Store.Create(createCtx, actor.ID, input, text, media)
	if err != nil {
		fluoError(w, err)
		return
	}
	if err := h.decorate(&post); err != nil {
		fluoError(w, err)
		return
	}
	w.Header().Set("Location", "/v1/fluo/posts/"+post.ID)
	writeJSON(w, http.StatusCreated, post)
}

func validatePostInput(w http.ResponseWriter, input *fluo.NewPost) (string, bool) {
	if !encryption.ValidID(input.ID) {
		writeError(w, http.StatusBadRequest, "A device-generated post ID is required.")
		return "", false
	}
	if len(input.AltTexts) != 0 {
		writeError(w, http.StatusBadRequest, "Attachment descriptions must be encrypted on your device.")
		return "", false
	}
	if !validatePostReferences(w, input) {
		return "", false
	}
	content, text, err := fluo.ValidateContent(input.Content, input.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Posts must be encrypted on your device.")
		return "", false
	}
	input.Content = content
	if len(input.AttachmentIDs) > maxPostAttachments {
		writeError(w, http.StatusBadRequest, "A post can have at most four attachments.")
		return "", false
	}
	return text, true
}

func validatePostReferences(w http.ResponseWriter, input *fluo.NewPost) bool {
	if input.Visibility == "" {
		input.Visibility = fluo.VisibilityPublic
	}
	if !fluo.ValidVisibility(input.Visibility) {
		writeError(w, http.StatusBadRequest, invalidVisibilityMessage)
		return false
	}
	if input.ParentID != nil && input.QuoteID != nil {
		writeError(w, http.StatusBadRequest, "A post cannot be both a reply and a quote.")
		return false
	}
	for _, reference := range []*string{input.ParentID, input.QuoteID} {
		if reference != nil && !fluo.ValidID(*reference) {
			writeError(w, http.StatusBadRequest, "Invalid referenced post ID.")
			return false
		}
	}
	return true
}

func (h fluoHandler) delete(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	mediaIDs, err := h.deps.Store.Delete(r.Context(), actor.ID, id)
	if err != nil {
		fluoError(w, err)
		return
	}
	h.purgeRetiredMedia(r.Context(), mediaIDs)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (h fluoHandler) setVisibility(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	var input fluo.VisibilityChange
	if !decodeBodyLimit(w, r, &input, 1<<20) {
		return
	}
	if !fluo.ValidVisibility(input.Visibility) {
		writeError(w, http.StatusBadRequest, invalidVisibilityMessage)
		return
	}
	// Public posts were readable by their audience, so hiding one only changes access; publishing re-encrypts it.
	var content json.RawMessage
	text := ""
	if input.Visibility == fluo.VisibilityPublic {
		var err error
		if content, text, err = fluo.ValidateContent(input.Content, id); err != nil {
			writeError(w, http.StatusBadRequest, "Re-encrypt this post for its audience before publishing it.")
			return
		}
	} else if len(input.Content) != 0 {
		writeError(w, http.StatusBadRequest, "Hiding a post does not replace its content.")
		return
	}
	if err := h.deps.Store.SetVisibility(r.Context(), actor.ID, id, input.Visibility, content, text); err != nil {
		fluoError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}
