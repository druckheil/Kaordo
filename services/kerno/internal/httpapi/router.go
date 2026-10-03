package httpapi

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
	"github.com/go-chi/chi/v5"
)

type VerifyFunc func(context.Context, string) (identity.Claims, error)

type UserStore interface {
	Upsert(context.Context, string, string, string) (postgres.User, error)
	BySubject(context.Context, string) (postgres.User, error)
}

func NewRouter(verify VerifyFunc, users UserStore, allowedOrigins []string) http.Handler {
	return NewRouterWithFluo(verify, users, FluoDependencies{}, allowedOrigins)
}

func NewRouterWithFluo(verify VerifyFunc, users UserStore, social FluoDependencies, allowedOrigins []string) http.Handler {
	return NewRouterWithModules(verify, users, social, LigoDependencies{}, allowedOrigins)
}

func NewRouterWithModules(verify VerifyFunc, users UserStore, social FluoDependencies, messaging LigoDependencies, allowedOrigins []string) http.Handler {
	return NewRouterWithRondo(verify, users, social, messaging, RondoDependencies{}, allowedOrigins)
}

func NewRouterWithRondo(verify VerifyFunc, users UserStore, social FluoDependencies, messaging LigoDependencies, communities RondoDependencies, allowedOrigins []string) http.Handler {
	return NewRouterWithAdmin(verify, users, social, messaging, communities, AdminDependencies{}, allowedOrigins)
}

func NewRouterWithAdmin(verify VerifyFunc, users UserStore, social FluoDependencies, messaging LigoDependencies, communities RondoDependencies, admin AdminDependencies, allowedOrigins []string) http.Handler {
	router := chi.NewRouter()
	origins := make(map[string]bool, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			origins[trimmed] = true
		}
	}

	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Add("Vary", "Origin")
			if origin := r.Header.Get("Origin"); origin != "" {
				if !origins[origin] {
					writeError(w, http.StatusForbidden, "Origin is not allowed.")
					return
				}
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	router.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	router.Post("/v1/session", func(w http.ResponseWriter, r *http.Request) {
		claims, ok := authenticate(w, r, verify)
		if !ok {
			return
		}
		user, err := users.Upsert(r.Context(), claims.Subject, claims.Username, claims.Name)
		if err != nil {
			log.Printf("account record upsert failed: %v", err)
			writeError(w, http.StatusInternalServerError, "Could not create the account record.")
			return
		}
		if user.DisabledAt != nil {
			writeError(w, http.StatusForbidden, "This account is disabled.")
			return
		}
		writeJSON(w, http.StatusOK, user)
	})
	router.Get("/v1/me", func(w http.ResponseWriter, r *http.Request) {
		claims, ok := authenticate(w, r, verify)
		if !ok {
			return
		}
		user, err := users.BySubject(r.Context(), claims.Subject)
		if postgres.IsNotFound(err) {
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
	})
	if social.Store != nil {
		mountFluo(router, verify, users, social)
	}
	if messaging.Store != nil {
		mountLigo(router, verify, users, messaging)
	}
	if communities.Store != nil {
		mountRondo(router, verify, users, communities)
	}
	if admin.Store != nil {
		mountAdmin(router, verify, users, admin)
	}
	return router
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
		message := map[string]string{
			"expired_token":    "The session token has expired. Sign in again.",
			"missing_subject":  "The identity token has no subject.",
			"missing_username": "The identity token has no username. Check the Keycloak profile scope.",
			"invalid_audience": "The identity token is not valid for Kerno. Check the Keycloak API audience.",
			"invalid_issuer":   "The identity token comes from a different issuer. Check the authentication URLs.",
			"invalid_token":    "The session token could not be verified.",
		}[code]
		writeAuthError(w, code, message)
		return identity.Claims{}, false
	}
	return claims, true
}

func writeAuthError(w http.ResponseWriter, code, message string) {
	writeJSON(w, http.StatusUnauthorized, map[string]string{"code": code, "error": message})
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
