package httpapi

// Coordinates Fluo post creation, visibility and deletion
import (
	"context"
	"net/http"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/go-chi/chi/v5"
)

func (h fluoHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input fluo.NewPost
	if !decodeBody(w, r, &input) {
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
	if !validatePostReferences(w, input) {
		return "", false
	}
	maximum := 5000
	if input.ParentID != nil {
		maximum = 2000
	}
	content, text, err := fluo.ValidateContent(input.Content, maximum)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return "", false
	}
	input.Content = content
	if len(input.AttachmentIDs) > maxPostAttachments {
		writeError(w, http.StatusBadRequest, "A post can have at most four attachments.")
		return "", false
	}
	if text == "" && len(input.AttachmentIDs) == 0 && input.QuoteID == nil {
		writeError(w, http.StatusBadRequest, "Write something or attach media before publishing.")
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
	var input struct {
		Visibility string `json:"visibility"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	if !fluo.ValidVisibility(input.Visibility) {
		writeError(w, http.StatusBadRequest, invalidVisibilityMessage)
		return
	}
	if err := h.deps.Store.SetVisibility(r.Context(), actor.ID, id, input.Visibility); err != nil {
		fluoError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}
