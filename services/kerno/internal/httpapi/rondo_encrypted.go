package httpapi

// Exposes owner metadata migration and member-scoped encrypted voice keys
import (
	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondo"
	"github.com/go-chi/chi/v5"
	"net/http"
)

func (h rondoHandler) encryptedStore(w http.ResponseWriter) (rondo.EncryptedStore, bool) {
	store, ok := h.deps.Store.(rondo.EncryptedStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "Encrypted server storage is unavailable.")
	}
	return store, ok
}
func (h rondoHandler) voiceKey(w http.ResponseWriter, r *http.Request) {
	h.voiceKeyRequest(w, r, false)
}
func (h rondoHandler) setVoiceKey(w http.ResponseWriter, r *http.Request) {
	h.voiceKeyRequest(w, r, true)
}
func (h rondoHandler) voiceKeyRequest(w http.ResponseWriter, r *http.Request, write bool) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !encryption.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid channel ID.")
		return
	}
	store, ok := h.encryptedStore(w)
	if !ok {
		return
	}
	var value rondo.VoiceKey
	var err error
	if write {
		if !decodeBodyLimit(w, r, &value, 1<<20) {
			return
		}
		if value.Revision < 0 || !encryption.ValidIndex(value.MembershipTag) {
			writeError(w, http.StatusBadRequest, "Invalid encrypted room revision.")
			return
		}
		value, err = store.SetVoiceKey(r.Context(), actor.ID, id, value)
	} else {
		value, err = store.VoiceKey(r.Context(), actor.ID, id)
	}
	if err != nil {
		rondoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}
