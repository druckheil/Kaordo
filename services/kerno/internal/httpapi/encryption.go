package httpapi

// Exposes only public identities and sealed keys belonging to the authenticated account
import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/go-chi/chi/v5"
)

type EncryptionDependencies struct{ Store encryption.Store }
type encryptionHandler struct {
	verify VerifyFunc
	users  account.Store
	store  encryption.Store
}

func mountEncryption(router chi.Router, verify VerifyFunc, users account.Store, deps EncryptionDependencies) {
	h := encryptionHandler{verify: verify, users: users, store: deps.Store}
	router.Route("/v1/crypto", func(r chi.Router) {
		r.Get("/identity", h.identity)
		r.Get("/recovery", h.recovery)
		r.Put("/recovery", h.setRecovery)
		r.Get("/users/{id}", h.publicIdentity)
		r.Get("/audience/{module}/{id}", h.audience)
		r.Post("/devices", h.register)
		r.Post("/devices/{id}/approve", h.approve)
		r.Put("/devices/{id}/session", h.useDevice)
		r.Delete("/devices/{id}", h.forgetDevice)
	})
}
func (h encryptionHandler) forgetDevice(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !encryption.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Use a valid device ID.")
		return
	}
	var input encryption.DeviceRemoval
	if !decodeBody(w, r, &input) {
		return
	}
	identity, err := h.store.ForgetDevice(r.Context(), actor.ID, id, input)
	encryptionResponse(w, identity, err)
}
func (h encryptionHandler) recovery(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	sealed, err := h.store.Recovery(r.Context(), actor.ID)
	encryptionResponse(w, map[string]string{"wrappedKeys": sealed}, err)
}
func (h encryptionHandler) setRecovery(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input encryption.RecoveryUpdate
	if !decodeBody(w, r, &input) {
		return
	}
	err := h.store.SetRecovery(r.Context(), actor.ID, input)
	encryptionResponse(w, map[string]bool{"saved": err == nil}, err)
}
func (h encryptionHandler) actor(w http.ResponseWriter, r *http.Request) (account.User, bool) {
	actor, _, ok := h.session(w, r)
	return actor, ok
}

// session is the actor and the identity provider session that device requests are recorded under
func (h encryptionHandler) session(w http.ResponseWriter, r *http.Request) (account.User, string, bool) {
	return authenticatedSession(w, r, h.verify, h.users, "Start an account session before managing encryption devices.")
}

func (h encryptionHandler) useDevice(w http.ResponseWriter, r *http.Request) {
	actor, session, ok := h.session(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !encryption.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Use a valid device ID.")
		return
	}
	err := h.store.UseDevice(r.Context(), actor.ID, session, id)
	encryptionResponse(w, map[string]bool{"recorded": err == nil}, err)
}
func (h encryptionHandler) identity(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	identity, err := h.store.Identity(r.Context(), actor.ID)
	encryptionResponse(w, map[string]any{"identity": identity}, err)
}
func (h encryptionHandler) register(w http.ResponseWriter, r *http.Request) {
	actor, session, ok := h.session(w, r)
	if !ok {
		return
	}
	var input encryption.Registration
	if !decodeBody(w, r, &input) {
		return
	}
	identity, err := h.store.Register(r.Context(), actor.ID, session, input)
	encryptionResponse(w, identity, err)
}
func (h encryptionHandler) approve(w http.ResponseWriter, r *http.Request) {
	actor, session, ok := h.session(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !encryption.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Use a valid device ID.")
		return
	}
	var input encryption.Approval
	if !decodeBody(w, r, &input) {
		return
	}
	identity, err := h.store.Approve(r.Context(), actor.ID, session, id, input)
	encryptionResponse(w, identity, err)
}
func encryptionResponse(w http.ResponseWriter, value any, err error) {
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, value)
	case errors.Is(err, encryption.ErrInvalid):
		writeError(w, http.StatusBadRequest, "Invalid device identity or signed approval.")
	case errors.Is(err, encryption.ErrNotFound):
		writeError(w, http.StatusNotFound, "This account has not set up device encryption yet.")
	case errors.Is(err, encryption.ErrConflict):
		writeError(w, http.StatusConflict, "This device identity changed. Use its original key.")
	case errors.Is(err, encryption.ErrLimit):
		writeError(w, http.StatusConflict, "An account can have up to 20 encryption devices.")
	default:
		slog.Error("encryption identity request failed", "err", err)
		writeError(w, http.StatusInternalServerError, "Could not load encryption devices.")
	}
}

func (h encryptionHandler) publicIdentity(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.actor(w, r); !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !encryption.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Use a valid account ID.")
		return
	}
	item, err := h.store.PublicIdentity(r.Context(), id)
	encryptionResponse(w, item, err)
}
func (h encryptionHandler) audience(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !encryption.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Use a valid audience ID.")
		return
	}
	item, err := h.store.Audience(r.Context(), actor.ID, chi.URLParam(r, "module"), id, r.URL.Query().Get("private") == "true")
	encryptionResponse(w, item, err)
}
