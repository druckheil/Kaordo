package httpapi

// Coordinates Fluo saved posts, reactions and follow transitions
import (
	"net/http"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/go-chi/chi/v5"
)

func (h fluoHandler) savePost(w http.ResponseWriter, r *http.Request) { h.setSaved(w, r, true) }

func (h fluoHandler) unsavePost(w http.ResponseWriter, r *http.Request) { h.setSaved(w, r, false) }

func (h fluoHandler) setSaved(w http.ResponseWriter, r *http.Request, saved bool) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	if err := h.deps.Store.SetSaved(r.Context(), actor.ID, id, saved); err != nil {
		fluoError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (h fluoHandler) react(w http.ResponseWriter, r *http.Request) { h.setReaction(w, r, true) }

func (h fluoHandler) unreact(w http.ResponseWriter, r *http.Request) { h.setReaction(w, r, false) }

func (h fluoHandler) setReaction(w http.ResponseWriter, r *http.Request, set bool) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	var value *string
	if set {
		var request struct {
			Value string `json:"value"`
		}
		if !decodeBody(w, r, &request) {
			return
		}
		if request.Value != "good" && request.Value != "bad" {
			writeError(w, http.StatusBadRequest, "Reaction must be good or bad.")
			return
		}
		value = &request.Value
	}
	post, err := h.deps.Store.React(r.Context(), actor.ID, id, value)
	if err != nil {
		fluoError(w, err)
		return
	}
	if err := h.decorate(&post); err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, post)
}

func (h fluoHandler) follow(w http.ResponseWriter, r *http.Request) { h.setFollow(w, r, true) }

func (h fluoHandler) unfollow(w http.ResponseWriter, r *http.Request) { h.setFollow(w, r, false) }

func (h fluoHandler) setFollow(w http.ResponseWriter, r *http.Request, following bool) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid account ID.")
		return
	}
	if err := h.deps.Store.Follow(r.Context(), actor.ID, id, following); err != nil {
		fluoError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}
