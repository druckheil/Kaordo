package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
	"github.com/druckheil/Kaordo/services/mediaauth"
	"github.com/go-chi/chi/v5"
)

type AdminStore interface {
	Summary(context.Context) (postgres.AdminSummary, error)
	Users(context.Context, string) ([]postgres.AdminUser, error)
	SetDisabled(context.Context, string, string, bool, string) (postgres.AdminUser, error)
	SetAdmin(context.Context, string, string, bool, string) (postgres.AdminUser, error)
	Audit(context.Context) ([]postgres.AdminAuditEntry, error)
	Record(context.Context, string, string, string, string, any) error
	CreateAccessCase(context.Context, string, string, string) (postgres.AdminAccessCase, error)
	AccessCase(context.Context, string, string) (postgres.AdminAccessCase, error)
	CloseCase(context.Context, string, string) error
	CaseContent(context.Context, string, string, string) (postgres.AdminContentPage, error)
}

type AdminSystem interface {
	Snapshot(context.Context) (json.RawMessage, error)
	Logs(context.Context, string) (json.RawMessage, error)
	Action(context.Context, string) (json.RawMessage, error)
}

type AdminMetrics interface {
	History(context.Context, string) (json.RawMessage, error)
}

type AdminDependencies struct {
	Store        AdminStore
	System       AdminSystem
	Metrics      AdminMetrics
	MediaBaseURL string
	MediaSignKey []byte
}

type adminActorKey struct{}

type adminHandler struct{ deps AdminDependencies }

func mountAdmin(router chi.Router, verify VerifyFunc, users UserStore, deps AdminDependencies) {
	h := adminHandler{deps: deps}
	router.Route("/v1/admin", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				claims, ok := authenticate(w, request, verify)
				if !ok {
					return
				}
				actor, err := users.BySubject(request.Context(), claims.Subject)
				if err != nil || actor.DisabledAt != nil || !actor.IsAdmin {
					writeError(w, http.StatusForbidden, "Administrator access is required.")
					return
				}
				next.ServeHTTP(w, request.WithContext(context.WithValue(request.Context(), adminActorKey{}, actor)))
			})
		})
		r.Get("/summary", h.summary)
		r.Get("/users", h.users)
		r.Patch("/users/{id}/status", h.setStatus)
		r.Patch("/users/{id}/role", h.setRole)
		r.Get("/audit", h.audit)
		r.Post("/cases", h.createCase)
		r.Get("/cases/{id}/content", h.caseContent)
		r.Post("/cases/{id}/close", h.closeCase)
		r.Get("/system", h.system)
		r.Get("/metrics", h.metrics)
		r.Get("/logs", h.logs)
		r.Post("/actions/{action}", h.action)
	})
}

func adminActor(r *http.Request) postgres.User {
	return r.Context().Value(adminActorKey{}).(postgres.User)
}

func adminFailure(w http.ResponseWriter, err error) {
	if errors.Is(err, postgres.ErrAdminTarget) || postgres.IsNotFound(err) {
		writeError(w, http.StatusNotFound, "The requested account or access case is unavailable.")
	} else if errors.Is(err, postgres.ErrAccessLimit) {
		writeError(w, http.StatusTooManyRequests, "The access case limit is three per hour.")
	} else {
		log.Printf("Regado request failed: %v", err)
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

func (h adminHandler) summary(w http.ResponseWriter, r *http.Request) {
	item, err := h.deps.Store.Summary(r.Context())
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h adminHandler) users(w http.ResponseWriter, r *http.Request) {
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(search) > 50 {
		writeError(w, http.StatusBadRequest, "Search is too long.")
		return
	}
	items, err := h.deps.Store.Users(r.Context(), search)
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h adminHandler) setStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid account ID.")
		return
	}
	var body struct {
		Disabled *bool  `json:"disabled"`
		Reason   string `json:"reason"`
	}
	if !decodeAdminBody(w, r, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if body.Disabled == nil || utf8.RuneCountInString(body.Reason) < 10 || utf8.RuneCountInString(body.Reason) > 500 {
		writeError(w, http.StatusBadRequest, "A reason of 10 to 500 characters is required.")
		return
	}
	item, err := h.deps.Store.SetDisabled(r.Context(), adminActor(r).ID, id, *body.Disabled, body.Reason)
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h adminHandler) audit(w http.ResponseWriter, r *http.Request) {
	items, err := h.deps.Store.Audit(r.Context())
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h adminHandler) setRole(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		IsAdmin *bool  `json:"isAdmin"`
		Reason  string `json:"reason"`
	}
	if !decodeAdminBody(w, r, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if !fluo.ValidID(id) || body.IsAdmin == nil || utf8.RuneCountInString(body.Reason) < 10 || utf8.RuneCountInString(body.Reason) > 500 {
		writeError(w, http.StatusBadRequest, "Select an account, a role and a reason of 10 to 500 characters.")
		return
	}
	item, err := h.deps.Store.SetAdmin(r.Context(), adminActor(r).ID, id, *body.IsAdmin, body.Reason)
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h adminHandler) closeCase(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid access case ID.")
		return
	}
	if err := h.deps.Store.CloseCase(r.Context(), adminActor(r).ID, id); err != nil {
		adminFailure(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h adminHandler) createCase(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TargetUserID string `json:"targetUserId"`
		Reason       string `json:"reason"`
	}
	if !decodeAdminBody(w, r, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if !fluo.ValidID(body.TargetUserID) || utf8.RuneCountInString(body.Reason) < 20 || utf8.RuneCountInString(body.Reason) > 500 {
		writeError(w, http.StatusBadRequest, "Select an account and provide a reason of 20 to 500 characters.")
		return
	}
	item, err := h.deps.Store.CreateAccessCase(r.Context(), adminActor(r).ID, body.TargetUserID, body.Reason)
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (h adminHandler) caseContent(w http.ResponseWriter, r *http.Request) {
	caseID, kind, before := chi.URLParam(r, "id"), r.URL.Query().Get("kind"), r.URL.Query().Get("before")
	if !fluo.ValidID(caseID) || (kind != "posts" && kind != "messages") || (before != "" && !fluo.ValidID(before)) {
		writeError(w, http.StatusBadRequest, "Invalid access case query.")
		return
	}
	actor := adminActor(r)
	accessCase, err := h.deps.Store.AccessCase(r.Context(), actor.ID, caseID)
	if err != nil {
		adminFailure(w, err)
		return
	}
	if err := h.deps.Store.Record(r.Context(), actor.ID, accessCase.TargetUserID, "case.read", accessCase.Reason,
		map[string]string{"caseId": caseID, "targetUserId": accessCase.TargetUserID, "kind": kind, "before": before}); err != nil {
		adminFailure(w, err)
		return
	}
	page, err := h.deps.Store.CaseContent(r.Context(), accessCase.TargetUserID, kind, before)
	if err != nil {
		adminFailure(w, err)
		return
	}
	for i := range page.Items {
		for j := range page.Items[i].Media {
			url, err := mediaauth.SignedURL(h.deps.MediaBaseURL, page.Items[i].Media[j].ID,
				time.Now().Add(time.Minute), h.deps.MediaSignKey)
			if err != nil {
				adminFailure(w, err)
				return
			}
			page.Items[i].Media[j].URL = url
		}
	}
	writeJSON(w, http.StatusOK, page)
}

func (h adminHandler) system(w http.ResponseWriter, r *http.Request) {
	if h.deps.System == nil {
		writeError(w, http.StatusServiceUnavailable, "System agent is unavailable.")
		return
	}
	item, err := h.deps.System.Snapshot(r.Context())
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h adminHandler) metrics(w http.ResponseWriter, r *http.Request) {
	if h.deps.Metrics == nil {
		writeError(w, http.StatusServiceUnavailable, "Metrics are unavailable.")
		return
	}
	window := r.URL.Query().Get("window")
	if window != "1h" && window != "24h" && window != "7d" {
		writeError(w, http.StatusBadRequest, "Invalid metrics window.")
		return
	}
	item, err := h.deps.Metrics.History(r.Context(), window)
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h adminHandler) logs(w http.ResponseWriter, r *http.Request) {
	if h.deps.System == nil {
		writeError(w, http.StatusServiceUnavailable, "System agent is unavailable.")
		return
	}
	service := r.URL.Query().Get("service")
	if !validAdminService(service) {
		writeError(w, http.StatusBadRequest, "Unsupported service.")
		return
	}
	if err := h.deps.Store.Record(r.Context(), adminActor(r).ID, "", "log.read", "", map[string]string{"service": service}); err != nil {
		adminFailure(w, err)
		return
	}
	item, err := h.deps.System.Logs(r.Context(), service)
	if err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func validAdminService(service string) bool {
	switch service {
	case "kerno", "nodo", "keycloak", "postgresql", "caddy", "livekit", "ddclient", "prometheus", "prometheus-node-exporter", "regado-agent":
		return true
	}
	return false
}

func (h adminHandler) action(w http.ResponseWriter, r *http.Request) {
	if h.deps.System == nil {
		writeError(w, http.StatusServiceUnavailable, "System agent is unavailable.")
		return
	}
	action := chi.URLParam(r, "action")
	switch action {
	case "restart-nodo", "restart-livekit", "restart-ddclient", "scrub-data":
	default:
		writeError(w, http.StatusBadRequest, "Unsupported system action.")
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if !decodeAdminBody(w, r, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if utf8.RuneCountInString(body.Reason) < 10 || utf8.RuneCountInString(body.Reason) > 500 {
		writeError(w, http.StatusBadRequest, "A reason of 10 to 500 characters is required.")
		return
	}
	if err := h.deps.Store.Record(r.Context(), adminActor(r).ID, "", "system."+action, body.Reason,
		map[string]string{"status": "requested"}); err != nil {
		adminFailure(w, err)
		return
	}
	result, err := h.deps.System.Action(r.Context(), action)
	if err != nil {
		_ = h.deps.Store.Record(r.Context(), adminActor(r).ID, "", "system."+action+".failed", body.Reason, map[string]string{"status": "failed"})
		adminFailure(w, err)
		return
	}
	if err := h.deps.Store.Record(r.Context(), adminActor(r).ID, "", "system."+action+".completed", body.Reason,
		map[string]string{"status": "accepted"}); err != nil {
		log.Printf("Regado outcome audit failed: %v", err)
	}
	writeJSON(w, http.StatusAccepted, result)
}
