// Package httpapi exposes Kerno over HTTP, coordinating authentication, authorization and feature stores.
package httpapi

// Handles application account bootstrap and current identity
import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/go-chi/chi/v5"
)

func mountAccountRoutes(router chi.Router, verify VerifyFunc, users account.Store) {
	router.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	router.Post("/v1/session", func(w http.ResponseWriter, r *http.Request) {
		createSession(w, r, verify, users)
	})
	router.Get("/v1/me", func(w http.ResponseWriter, r *http.Request) {
		getSessionUser(w, r, verify, users)
	})
}

func createSession(w http.ResponseWriter, r *http.Request, verify VerifyFunc, users account.Store) {
	claims, ok := authenticate(w, r, verify)
	if !ok {
		return
	}
	user, err := users.Upsert(r.Context(), claims.Subject, claims.Username, claims.Name)
	if err != nil {
		slog.Error("account record upsert failed", "err", err)
		writeError(w, http.StatusInternalServerError, "Could not create the account record.")
		return
	}
	if user.DisabledAt != nil {
		writeError(w, http.StatusForbidden, "This account is disabled.")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func getSessionUser(w http.ResponseWriter, r *http.Request, verify VerifyFunc, users account.Store) {
	claims, ok := authenticate(w, r, verify)
	if !ok {
		return
	}
	user, err := users.BySubject(r.Context(), claims.Subject)
	if errors.Is(err, account.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Account record not found. Start a new session.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load the account record.")
		return
	}
	if user.DisabledAt != nil {
		writeError(w, http.StatusForbidden, "This account is disabled.")
		return
	}
	writeJSON(w, http.StatusOK, user)
}
