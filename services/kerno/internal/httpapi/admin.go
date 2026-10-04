package httpapi

// Handles administrator account, audit, system, and access-case requests
import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
	"github.com/druckheil/Kaordo/services/kerno/internal/regado"
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
	Action(context.Context, string, regado.ActionRequest) (json.RawMessage, error)
}

type AdminMetrics interface {
	History(context.Context, string) (json.RawMessage, error)
}

type AdminStorageMaintenance interface {
	StorageStatus(context.Context) (json.RawMessage, error)
	StartStorageMaintenance(context.Context, bool) error
}

type AdminDependencies struct {
	Store        AdminStore
	System       AdminSystem
	Metrics      AdminMetrics
	Maintenance  AdminStorageMaintenance
	MediaBaseURL string
	MediaSignKey []byte
}

type adminActorKey struct{}

type adminHandler struct{ deps AdminDependencies }

func mountAdmin(router chi.Router, verify VerifyFunc, users UserStore, deps AdminDependencies) {
	h := adminHandler{deps: deps}
	router.Route("/v1/admin", func(r chi.Router) {
		r.Use(adminMiddleware(verify, users))
		r.Get("/summary", h.summary)
		r.Get("/users", h.users)
		r.Patch("/users/{id}/status", h.setStatus)
		r.Patch("/users/{id}/role", h.setRole)
		r.Get("/audit", h.audit)
		r.Post("/cases", h.createCase)
		r.Get("/cases/{id}/content", h.caseContent)
		r.Post("/cases/{id}/close", h.closeCase)
		r.Get("/system", h.system)
		r.Post("/storage/plan", func(w http.ResponseWriter, r *http.Request) { h.storageLayout(w, r, false) })
		r.Post("/storage/apply", func(w http.ResponseWriter, r *http.Request) { h.storageLayout(w, r, true) })
		r.Get("/metrics", h.metrics)
		r.Get("/logs", h.logs)
		r.Post("/actions/{action}", h.action)
	})
}

func adminMiddleware(verify VerifyFunc, users UserStore) func(http.Handler) http.Handler {
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

func adminActor(r *http.Request) postgres.User {
	return r.Context().Value(adminActorKey{}).(postgres.User)
}

func adminFailure(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrAdminTarget), postgres.IsNotFound(err):
		writeError(w, http.StatusNotFound, "The requested account or access case is unavailable.")
	case errors.Is(err, postgres.ErrAccessLimit):
		writeError(w, http.StatusTooManyRequests, "The access case limit is three per hour.")
	default:
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
	if body.Disabled == nil || !validAdminReason(body.Reason, 10, 500) {
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
	if !fluo.ValidID(id) || body.IsAdmin == nil || !validAdminReason(body.Reason, 10, 500) {
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
	if !fluo.ValidID(body.TargetUserID) || !validAdminReason(body.Reason, 20, 500) {
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

func validAdminReason(reason string, minimum, maximum int) bool {
	length := utf8.RuneCountInString(reason)
	return length >= minimum && length <= maximum
}

func (h adminHandler) caseContent(w http.ResponseWriter, r *http.Request) {
	caseID, kind, before, valid := adminCaseContentQuery(r)
	if !valid {
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
	if err := h.signCaseMedia(&page); err != nil {
		adminFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func adminCaseContentQuery(r *http.Request) (caseID, kind, before string, valid bool) {
	caseID = chi.URLParam(r, "id")
	kind = r.URL.Query().Get("kind")
	before = r.URL.Query().Get("before")
	valid = fluo.ValidID(caseID) && (kind == "posts" || kind == "messages") && (before == "" || fluo.ValidID(before))
	return caseID, kind, before, valid
}

func (h adminHandler) signCaseMedia(page *postgres.AdminContentPage) error {
	for itemIndex := range page.Items {
		for mediaIndex := range page.Items[itemIndex].Media {
			media := &page.Items[itemIndex].Media[mediaIndex]
			url, err := mediaauth.SignedURL(h.deps.MediaBaseURL, media.ID, time.Now().Add(time.Minute), h.deps.MediaSignKey)
			if err != nil {
				return err
			}
			media.URL = url
		}
	}
	return nil
}

func (h adminHandler) system(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystem(w) {
		return
	}
	item, err := h.deps.System.Snapshot(r.Context())
	if err != nil {
		adminFailure(w, err)
		return
	}
	var system map[string]json.RawMessage
	if err := json.Unmarshal(item, &system); err != nil {
		adminFailure(w, err)
		return
	}
	system["mediaMaintenance"] = json.RawMessage("null")
	if h.deps.Maintenance != nil {
		if status, err := h.deps.Maintenance.StorageStatus(r.Context()); err == nil {
			system["mediaMaintenance"] = status
		}
	}
	writeJSON(w, http.StatusOK, system)
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
	if !h.requireSystem(w) {
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

func (h adminHandler) requireSystem(w http.ResponseWriter) bool {
	if h.deps.System != nil {
		return true
	}
	writeError(w, http.StatusServiceUnavailable, "System agent is unavailable.")
	return false
}

func validAdminService(service string) bool {
	switch service {
	case "kerno", "nodo", "keycloak", "postgresql", "caddy", "livekit", "ddclient", "prometheus", "prometheus-node-exporter", "regado-agent":
		return true
	}
	return false
}

func (h adminHandler) action(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystem(w) {
		return
	}
	action := chi.URLParam(r, "action")
	if !validSystemAction(action) {
		writeError(w, http.StatusBadRequest, "Unsupported system action.")
		return
	}
	var body struct {
		Reason     string `json:"reason"`
		Target     string `json:"target"`
		Identity   string `json:"identity"`
		Filesystem string `json:"filesystem"`
	}
	if !decodeAdminBody(w, r, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if !validAdminReason(body.Reason, 10, 500) {
		writeError(w, http.StatusBadRequest, "A reason of 10 to 500 characters is required.")
		return
	}
	switch action {
	case "scrub-filesystem", "check-storage", "repair-storage":
		if body.Target == "" || (action != "scrub-filesystem" && body.Target == "/") || len(body.Target) > 1024 || !filepath.IsAbs(body.Target) || filepath.Clean(body.Target) != body.Target || body.Identity != "" || body.Filesystem != "" {
			writeError(w, http.StatusBadRequest, "A mounted filesystem path is required.")
			return
		}
	case "configure-storage":
		if !strings.HasPrefix(body.Target, "/dev/") || len(body.Target) > 256 || filepath.Clean(body.Target) != body.Target ||
			!validStorageIdentity(body.Identity) || body.Filesystem == "/" || len(body.Filesystem) > 1024 ||
			!filepath.IsAbs(body.Filesystem) || filepath.Clean(body.Filesystem) != body.Filesystem {
			writeError(w, http.StatusBadRequest, "A physical device, stable identity, and mounted data-pool path are required.")
			return
		}
	default:
		if body.Target != "" || body.Identity != "" || body.Filesystem != "" {
			writeError(w, http.StatusBadRequest, "This operation does not accept a storage target.")
			return
		}
	}
	var mediaDirectory string
	if action == "check-storage" || action == "repair-storage" {
		if h.deps.Maintenance == nil {
			writeError(w, http.StatusServiceUnavailable, "File-reference checks are unavailable.")
			return
		}
		status, err := h.deps.Maintenance.StorageStatus(r.Context())
		var media struct {
			Directory string `json:"directory"`
			State     string `json:"state"`
		}
		if err != nil || json.Unmarshal(status, &media) != nil || media.Directory == "" {
			writeError(w, http.StatusServiceUnavailable, "File-reference checks are unavailable.")
			return
		}
		mediaDirectory = media.Directory
		if (media.Directory == body.Target || strings.HasPrefix(media.Directory, body.Target+"/")) && (media.State == "checking" || media.State == "repairing") {
			writeError(w, http.StatusConflict, "A file-copy operation is already running.")
			return
		}
	}
	actorID := adminActor(r).ID
	if err := h.recordSystemAction(r.Context(), actorID, action, "", body.Reason, body.Target, body.Identity, body.Filesystem, "requested"); err != nil {
		adminFailure(w, err)
		return
	}
	result, err := h.deps.System.Action(r.Context(), action, regado.ActionRequest{
		Target: body.Target, Identity: body.Identity, Filesystem: body.Filesystem,
	})
	if err == nil && mediaDirectory != "" && (mediaDirectory == body.Target || strings.HasPrefix(mediaDirectory, body.Target+"/")) {
		err = h.deps.Maintenance.StartStorageMaintenance(r.Context(), action == "repair-storage")
	}
	if err != nil {
		_ = h.recordSystemAction(r.Context(), actorID, action, "failed", body.Reason, body.Target, body.Identity, body.Filesystem, "failed")
		adminFailure(w, err)
		return
	}
	if err := h.recordSystemAction(r.Context(), actorID, action, "completed", body.Reason, body.Target, body.Identity, body.Filesystem, "accepted"); err != nil {
		log.Printf("Regado outcome audit failed: %v", err)
	}
	writeJSON(w, http.StatusAccepted, result)
}

func validSystemAction(action string) bool {
	switch action {
	case "restart-nodo", "restart-livekit", "restart-ddclient", "scrub-filesystem", "check-storage", "repair-storage":
		return true
	case "configure-storage":
		return true
	default:
		return false
	}
}

func (h adminHandler) recordSystemAction(ctx context.Context, actorID, action, stage, reason, target, identity, filesystem, status string) error {
	event := "system." + action
	if stage != "" {
		event += "." + stage
	}
	details := map[string]string{"status": status}
	if target != "" {
		details["target"] = target
	}
	if identity != "" {
		details["identity"] = identity
	}
	if filesystem != "" {
		details["filesystem"] = filesystem
	}
	return h.deps.Store.Record(ctx, actorID, "", event, reason, details)
}

func validStorageIdentity(identity string) bool {
	return len(identity) > len("serial:") && len(identity) <= 256 &&
		(strings.HasPrefix(identity, "serial:") || strings.HasPrefix(identity, "wwn:"))
}
