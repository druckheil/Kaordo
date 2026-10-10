package httpapi

// Reads Fluo feeds and focused post threads with cursor pagination
import (
	"errors"
	"net/http"
	"strconv"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/go-chi/chi/v5"
)

func readPageOptions(r *http.Request, viewerID string, parentID *string) (fluo.ListOptions, error) {
	query := r.URL.Query()
	feed := query.Get("feed")
	if feed == "" {
		feed = "latest"
	}
	if feed != "latest" && feed != "following" && feed != "mine" && feed != "saved" {
		return fluo.ListOptions{}, errors.New("feed must be latest, following, mine or saved")
	}
	limit, err := parseFluoPageLimit(query.Get("limit"))
	if err != nil {
		return fluo.ListOptions{}, err
	}
	cursor, err := fluo.DecodeCursor(query.Get("cursor"))
	if err != nil {
		return fluo.ListOptions{}, err
	}
	options := fluo.ListOptions{ViewerID: viewerID, ParentID: parentID, Feed: feed, Limit: limit, Cursor: cursor}
	if authorID := query.Get("authorId"); authorID != "" {
		if !fluo.ValidID(authorID) {
			return fluo.ListOptions{}, errors.New("invalid profile account ID")
		}
		options.AuthorID = &authorID
	}
	return options, nil
}

func parseFluoPageLimit(raw string) (int, error) {
	if raw == "" {
		return 20, nil
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 50 {
		return 0, errors.New("limit must be between 1 and 50")
	}
	return limit, nil
}

func (h fluoHandler) page(w http.ResponseWriter, r *http.Request, parentID *string) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	options, err := readPageOptions(r, actor.ID, parentID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	page, err := h.deps.Store.List(r.Context(), options)
	if err != nil {
		fluoError(w, err)
		return
	}
	if err := h.decoratePage(&page); err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h fluoHandler) list(w http.ResponseWriter, r *http.Request) { h.page(w, r, nil) }

func (h fluoHandler) comments(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	h.page(w, r, &id)
}

func (h fluoHandler) get(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	post, err := h.deps.Store.Get(r.Context(), actor.ID, id)
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

func (h fluoHandler) thread(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	thread, err := h.deps.Store.Thread(r.Context(), actor.ID, id)
	if err != nil {
		fluoError(w, err)
		return
	}
	if err := h.decoratePosts(thread.Posts); err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, thread)
}
