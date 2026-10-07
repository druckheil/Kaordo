package httpapi

// Reads and updates Fluo settings for the authenticated account
import (
	"net/http"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
)

func (h fluoHandler) settings(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	settings, err := h.deps.Settings.Settings(r.Context(), actor.ID)
	if err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (h fluoHandler) updateSettings(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var patch fluo.SettingsPatch
	if !decodeBody(w, r, &patch) {
		return
	}
	settings, err := h.deps.Settings.UpdateSettings(r.Context(), actor.ID, patch)
	if err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}
