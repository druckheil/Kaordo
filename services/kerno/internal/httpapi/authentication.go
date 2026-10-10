package httpapi

// Authenticates bearer tokens and resolves authorized application actors
import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
)

type VerifyFunc func(context.Context, string) (identity.Claims, error)

var authFailureMessages = map[string]string{
	"expired_token":    "The session token has expired. Sign in again.",
	"missing_subject":  "The identity token has no subject.",
	"missing_username": "The identity token has no username. Check the Keycloak profile scope.",
	"invalid_audience": "The identity token is not valid for Kerno. Check the Keycloak API audience.",
	"invalid_issuer":   "The identity token comes from a different issuer. Check the authentication URLs.",
	"invalid_token":    "The session token could not be verified.",
}

func authenticatedActor(w http.ResponseWriter, r *http.Request, verify VerifyFunc, users account.Store, missingSessionMessage string) (account.User, bool) {
	actor, _, ok := authenticatedSession(w, r, verify, users, missingSessionMessage)
	return actor, ok
}

// authenticatedSession also returns the identity provider session the request belongs to
func authenticatedSession(w http.ResponseWriter, r *http.Request, verify VerifyFunc, users account.Store, missingSessionMessage string) (account.User, string, bool) {
	claims, ok := authenticate(w, r, verify)
	if !ok {
		return account.User{}, "", false
	}
	actor, err := users.BySubject(r.Context(), claims.Subject)
	if errors.Is(err, account.ErrNotFound) {
		writeError(w, http.StatusConflict, missingSessionMessage)
		return account.User{}, "", false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load your account.")
		return account.User{}, "", false
	}
	if actor.DisabledAt != nil {
		writeError(w, http.StatusForbidden, "This account is disabled.")
		return account.User{}, "", false
	}
	return actor, claims.SessionID, true
}

func authenticate(w http.ResponseWriter, r *http.Request, verify VerifyFunc) (identity.Claims, bool) {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		writeAuthError(w, "missing_token", "A bearer token is required.")
		return identity.Claims{}, false
	}
	claims, err := verify(r.Context(), parts[1])
	if err != nil {
		code := identity.FailureCode(err)
		writeAuthError(w, code, authFailureMessages[code])
		return identity.Claims{}, false
	}
	return claims, true
}

func writeAuthError(w http.ResponseWriter, code, message string) {
	writeJSON(w, http.StatusUnauthorized, map[string]string{"code": code, "error": message})
}
