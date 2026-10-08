package httpapi

// Validates Fluo attachments and decorates authorized media responses
import (
	"net/http"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/mediaauth"
	"github.com/go-chi/chi/v5"
)

func (h fluoHandler) decorate(post *fluo.Post) error {
	if err := h.signMedia(post.Media); err != nil {
		return err
	}
	if post.Quote != nil {
		return h.signMedia(post.Quote.Media)
	}
	return nil
}

func (h fluoHandler) signMedia(items []fluo.Media) error {
	// Keep URLs stable between frequent refreshes while retaining short-lived access.
	expires := time.Now().Truncate(time.Minute).Add(9 * time.Minute)
	for index := range items {
		url, err := mediaauth.SignedURL(h.deps.MediaBaseURL, items[index].ID, expires, h.deps.MediaSignKey)
		if err != nil {
			return err
		}
		items[index].URL = url
	}
	return nil
}

func (h fluoHandler) decoratePage(page *fluo.Page) error {
	return h.decoratePosts(page.Items)
}

func (h fluoHandler) decoratePosts(posts []fluo.Post) error {
	for index := range posts {
		if err := h.decorate(&posts[index]); err != nil {
			return err
		}
	}
	return nil
}

func (h fluoHandler) validatePostMedia(w http.ResponseWriter, r *http.Request, input fluo.NewPost) ([]fluo.Media, bool) {
	media := make([]fluo.Media, 0, len(input.AttachmentIDs))
	inputs := attachmentInputs{altTexts: input.AltTexts, seen: make(map[string]struct{}, len(input.AttachmentIDs))}
	for _, id := range input.AttachmentIDs {
		item, ok := h.validatePostAttachment(w, r, id, inputs)
		if !ok {
			return nil, false
		}
		media = append(media, item)
	}
	if err := inputs.validateReferences(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return nil, false
	}
	return media, true
}

func (h fluoHandler) validatePostAttachment(w http.ResponseWriter, r *http.Request, id string, inputs attachmentInputs) (fluo.Media, bool) {
	altText, err := inputs.normalize(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return fluo.Media{}, false
	}
	if h.deps.Media == nil {
		writeError(w, http.StatusServiceUnavailable, "Media storage is unavailable.")
		return fluo.Media{}, false
	}
	item, err := h.deps.Media.Validate(r.Context(), r.Header.Get("Authorization"), id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "An attachment is unavailable or not yours.")
		return fluo.Media{}, false
	}
	item.AltText = altText
	return item, true
}

func (h fluoHandler) mediaReferenced(w http.ResponseWriter, r *http.Request) {
	if !mediaauth.VerifyInternalToken(r.Header.Get("X-Kaordo-Internal-Token"), h.deps.MediaSignKey) {
		writeError(w, http.StatusForbidden, "Internal service access required.")
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid media ID.")
		return
	}
	referenced, err := h.deps.Store.MediaReferenced(r.Context(), id)
	if err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"referenced": referenced})
}
