package httpapi

// Exchanges author audience keys without ever receiving the self-only or sealed key material in clear
import (
	"net/http"
	"strconv"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
)

func (h fluoHandler) keyring(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	state, err := h.deps.Store.KeyringState(r.Context(), actor.ID)
	if err != nil {
		fluoError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, state)
}

func (h fluoHandler) updateKeyring(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input fluo.KeyringUpdate
	if !decodeBodyLimit(w, r, &input, 1<<20) {
		return
	}
	state, err := h.deps.Store.UpdateKeyring(r.Context(), actor.ID, input)
	if err != nil {
		fluoError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, state)
}

// keys accepts refs as ownerId:version pairs separated by commas
func (h fluoHandler) keys(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	values := strings.Split(r.URL.Query().Get("refs"), ",")
	refs := make([]encryption.KeyRef, 0, len(values))
	for _, value := range values {
		owner, version, found := strings.Cut(value, ":")
		number, err := strconv.Atoi(version)
		if !found || err != nil {
			writeError(w, http.StatusBadRequest, "Invalid audience key reference.")
			return
		}
		refs = append(refs, encryption.KeyRef{OwnerID: owner, Version: number})
	}
	items, err := h.deps.Store.Keys(r.Context(), actor.ID, refs)
	if err != nil {
		fluoError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
