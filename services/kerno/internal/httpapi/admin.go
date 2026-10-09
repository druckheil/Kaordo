package httpapi

// Handles administrator account, audit, system requests
import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/go-chi/chi/v5"
)

type AdminSystem = admin.SystemAgent

type AdminMetrics interface {
	History(context.Context, string) (json.RawMessage, error)
}

type AdminStorageMaintenance = admin.StorageMaintenance

type AdminDependencies struct {
	Store       admin.Store
	System      AdminSystem
	Metrics     AdminMetrics
	Maintenance AdminStorageMaintenance
	Hosts       *admin.Hosts
}

type adminActorKey struct{}

type adminHandler struct {
	deps       AdminDependencies
	operations *admin.SystemOperations
}

func mountAdmin(router chi.Router, verify VerifyFunc, users account.Store, deps AdminDependencies) {
	h := adminHandler{deps: deps, operations: admin.NewSystemOperations(deps.Store, deps.System, deps.Maintenance)}
	router.Route("/v1/admin", func(r chi.Router) {
		r.Use(adminMiddleware(verify, users))
		r.Get("/summary", h.summary)
		r.Get("/users", h.users)
		r.Patch("/users/{id}/status", h.setStatus)
		r.Patch("/users/{id}/role", h.setRole)
		r.Get("/audit", h.audit)
		r.Get("/system", h.system)
		r.Post("/storage/plan", func(w http.ResponseWriter, r *http.Request) { h.storageLayout(w, r, false) })
		r.Post("/storage/apply", func(w http.ResponseWriter, r *http.Request) { h.storageLayout(w, r, true) })
		r.Get("/metrics", h.metrics)
		r.Get("/logs", h.logs)
		r.Patch("/logs/retention", h.logRetention)
		r.Post("/actions/{action}", h.action)
		mountAdminHosts(r, deps.Hosts)
	})
}

func adminMiddleware(verify VerifyFunc, users account.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := authenticate(w, r, verify)
			if !ok {
				return
			}
			actor, err := users.BySubject(r.Context(), claims.Subject)
			if err != nil || actor.DisabledAt != nil || !actor.IsAdmin {
				writeError(w, http.StatusForbidden, "Administrator access is required.")
				return
			}
			ctx := context.WithValue(r.Context(), adminActorKey{}, actor)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func adminActor(r *http.Request) account.User {
	return r.Context().Value(adminActorKey{}).(account.User)
}

func adminFailure(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, admin.ErrTarget), errors.Is(err, admin.ErrNotFound):
		writeError(w, http.StatusNotFound, "The requested account is unavailable.")
	default:
		slog.Error("Regado request failed", "err", err)
		writeError(w, http.StatusInternalServerError, "Regado could not complete this request.")
	}
}

func decodeAdminBody(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body.")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "Invalid request body.")
		return false
	}
	return true
}
