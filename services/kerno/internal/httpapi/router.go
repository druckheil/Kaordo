package httpapi

// Mounts Kerno HTTP routes and provides shared authentication and response helpers
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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

var authFailureMessages = map[string]string{
	"expired_token":    "The session token has expired. Sign in again.",
	"missing_subject":  "The identity token has no subject.",
	"missing_username": "The identity token has no username. Check the Keycloak profile scope.",
	"invalid_audience": "The identity token is not valid for Kerno. Check the Keycloak API audience.",
	"invalid_issuer":   "The identity token comes from a different issuer. Check the authentication URLs.",
	"invalid_token":    "The session token could not be verified.",
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
	return NewRouterWithServices(verify, users, Modules{Fluo: social, Ligo: messaging, Rondo: communities, Admin: admin}, allowedOrigins)
}

type Modules struct {
	Fluo   FluoDependencies
	Ligo   LigoDependencies
	Rondo  RondoDependencies
	Admin  AdminDependencies
	Lingvo LingvoDependencies
}

func NewRouterWithServices(verify VerifyFunc, users UserStore, modules Modules, allowedOrigins []string) http.Handler {
	social, messaging, communities, admin := modules.Fluo, modules.Ligo, modules.Rondo, modules.Admin
	router := chi.NewRouter()
	router.Use(corsMiddleware(allowedOrigins))
	mountAccountRoutes(router, verify, users)
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
	if modules.Lingvo.Store != nil {
		mountLingvo(router, verify, users, modules.Lingvo)
	}
	return router
}

func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	origins := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			origins[trimmed] = struct{}{}
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Add("Vary", "Origin")
			if !setAllowedOrigin(w, r, origins) {
				return
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func setAllowedOrigin(w http.ResponseWriter, r *http.Request, allowed map[string]struct{}) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	if _, ok := allowed[origin]; !ok {
		writeError(w, http.StatusForbidden, "Origin is not allowed.")
		return false
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	return true
}

func mountAccountRoutes(router chi.Router, verify VerifyFunc, users UserStore) {
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

func createSession(w http.ResponseWriter, r *http.Request, verify VerifyFunc, users UserStore) {
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
}

func getSessionUser(w http.ResponseWriter, r *http.Request, verify VerifyFunc, users UserStore) {
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
}

func authenticatedActor(w http.ResponseWriter, r *http.Request, verify VerifyFunc, users UserStore, missingSessionMessage string) (postgres.User, bool) {
	claims, ok := authenticate(w, r, verify)
	if !ok {
		return postgres.User{}, false
	}
	actor, err := users.BySubject(r.Context(), claims.Subject)
	if postgres.IsNotFound(err) {
		writeError(w, http.StatusConflict, missingSessionMessage)
		return postgres.User{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load your account.")
		return postgres.User{}, false
	}
	if actor.DisabledAt != nil {
		writeError(w, http.StatusForbidden, "This account is disabled.")
		return postgres.User{}, false
	}
	return actor, true
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

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func decodeBody(w http.ResponseWriter, r *http.Request, destination any) bool {
	return decodeBodyLimit(w, r, destination, 64*1024)
}

func decodeBodyLimit(w http.ResponseWriter, r *http.Request, destination any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body or body exceeds the %d KiB limit.", limit/1024))
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "Request body must contain one JSON object.")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
