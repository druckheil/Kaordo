package httpapi

// Coordinates administrative account status and role changes
import (
	"net/http"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/go-chi/chi/v5"
)

func (h adminHandler) summary(w http.ResponseWriter, r *http.Request) {
	item, err := h.deps.Store.Summary(r.Context())
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h adminHandler) users(w http.ResponseWriter, r *http.Request) {
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(search) > 50 {
		writeError(w, http.StatusBadRequest, "Search is too long.")
		return
	}
	items, err := h.deps.Store.Users(r.Context(), search)
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h adminHandler) setStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid account ID.")
		return
	}
	var body struct {
		Disabled *bool  `json:"disabled"`
		Reason   string `json:"reason"`
	}
	if !decodeAdminBody(w, r, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if body.Disabled == nil || !admin.ValidReason(body.Reason, 10, 500) {
		writeError(w, http.StatusBadRequest, "A reason of 10 to 500 characters is required.")
		return
	}
	item, err := h.deps.Store.SetDisabled(r.Context(), adminActor(r).ID, id, *body.Disabled, body.Reason)
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h adminHandler) audit(w http.ResponseWriter, r *http.Request) {
	items, err := h.deps.Store.Audit(r.Context())
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h adminHandler) setRole(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		IsAdmin *bool  `json:"isAdmin"`
		Reason  string `json:"reason"`
	}
	if !decodeAdminBody(w, r, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if !fluo.ValidID(id) || body.IsAdmin == nil || !admin.ValidReason(body.Reason, 10, 500) {
		writeError(w, http.StatusBadRequest, "Select an account, a role and a reason of 10 to 500 characters.")
		return
	}
	item, err := h.deps.Store.SetAdmin(r.Context(), adminActor(r).ID, id, *body.IsAdmin, body.Reason)
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}
