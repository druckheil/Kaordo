package httpapi

// Handles authenticated Fluo notification lists, counts, and recipient read state
import (
	"errors"
	"net/http"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/go-chi/chi/v5"
)

func (h fluoHandler) notifications(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	limit, err := parseFluoPageLimit(r.URL.Query().Get("limit"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	cursor, err := fluo.DecodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	page, err := h.deps.Notifications.Notifications(r.Context(), fluo.NotificationOptions{
		ViewerID: actor.ID, Cursor: cursor, Limit: limit,
	})
	if err != nil {
		fluoError(w, err)
		return
	}
	for _, notification := range page.Items {
		if notification.Post != nil {
			if err := h.signMedia(notification.Post.Media); err != nil {
				fluoError(w, err)
				return
			}
		}
	}
	writeJSON(w, http.StatusOK, page)
}

func (h fluoHandler) notificationSummary(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	summary, err := h.deps.Notifications.NotificationSummary(r.Context(), actor.ID)
	if err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (h fluoHandler) readNotification(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid notification ID.")
		return
	}
	state, err := h.deps.Notifications.ReadNotification(r.Context(), actor.ID, id)
	if errors.Is(err, fluo.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Notification not found.")
		return
	}
	if err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (h fluoHandler) readNotifications(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input struct {
		Through string `json:"through"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	through, err := fluo.DecodeCursor(input.Through)
	if err != nil || through == nil {
		writeError(w, http.StatusBadRequest, "A valid notification boundary is required.")
		return
	}
	summary, err := h.deps.Notifications.ReadNotificationsThrough(r.Context(), actor.ID, *through)
	if err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}
