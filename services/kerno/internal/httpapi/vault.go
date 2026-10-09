package httpapi

// Exposes authenticated owner-only opaque reads and revision-checked encrypted transactions
import (
	"errors"
	"log"
	"net/http"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/vault"
	"github.com/go-chi/chi/v5"
)

type VaultDependencies struct{ Store vault.Store }

func mountVault(router chi.Router, verify VerifyFunc, users account.Store, deps VaultDependencies) {
	actor := func(w http.ResponseWriter, r *http.Request) (account.User, bool) {
		return authenticatedActor(w, r, verify, users, "Start an account session before opening encrypted records.")
	}
	router.Post("/v1/crypto/records/read", func(w http.ResponseWriter, r *http.Request) {
		user, ok := actor(w, r)
		if !ok {
			return
		}
		var input struct {
			Tags []string `json:"tags"`
		}
		if !decodeBody(w, r, &input) {
			return
		}
		items, err := deps.Store.Read(r.Context(), user.ID, input.Tags)
		vaultResponse(w, items, err)
	})
	router.Post("/v1/crypto/records/commit", func(w http.ResponseWriter, r *http.Request) {
		user, ok := actor(w, r)
		if !ok {
			return
		}
		var input vault.Transaction
		if !decodeBodyLimit(w, r, &input, 16<<20) {
			return
		}
		items, err := deps.Store.Commit(r.Context(), user.ID, input)
		vaultResponse(w, items, err)
	})
}

func vaultResponse(w http.ResponseWriter, items []vault.Record, err error) {
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	case errors.Is(err, encryption.ErrInvalid):
		writeError(w, http.StatusBadRequest, "The encrypted record transaction is invalid or too large.")
	case errors.Is(err, encryption.ErrConflict):
		writeError(w, http.StatusConflict, "Your encrypted data changed on another device. Reload before saving.")
	default:
		log.Printf("Encrypted record request failed: %v", err)
		writeError(w, http.StatusInternalServerError, "Could not complete the encrypted record request.")
	}
}
