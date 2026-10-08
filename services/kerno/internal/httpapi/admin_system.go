package httpapi

// Reads system state and metrics and coordinates audited host actions
import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/go-chi/chi/v5"
)

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
	var body systemActionInput
	if !decodeAdminBody(w, r, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if err := body.validate(action); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var mediaMaintenance bool
	if action == "check-storage" || action == "repair-storage" {
		var ready bool
		mediaMaintenance, ready = h.prepareStorageMaintenance(w, r, body.Target)
		if !ready {
			return
		}
	}
	actorID := adminActor(r).ID
	if err := h.recordSystemAction(r.Context(), actorID, action, "", body.Reason, body.Target, body.Identity, body.Filesystem, "requested"); err != nil {
		adminFailure(w, err)
		return
	}
	result, err := h.deps.System.Action(r.Context(), action, admin.ActionRequest{
		Target: body.Target, Identity: body.Identity, Filesystem: body.Filesystem,
	})
	if err == nil && mediaMaintenance {
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

type systemActionInput struct {
	Reason     string `json:"reason"`
	Target     string `json:"target"`
	Identity   string `json:"identity"`
	Filesystem string `json:"filesystem"`
}

func (body systemActionInput) validate(action string) error {
	if !validAdminReason(body.Reason, 10, 500) {
		return errors.New("A reason of 10 to 500 characters is required.")
	}
	switch action {
	case "scrub-filesystem", "check-storage", "repair-storage":
		if body.Target == "" || (action != "scrub-filesystem" && body.Target == "/") || len(body.Target) > 1024 || !filepath.IsAbs(body.Target) || filepath.Clean(body.Target) != body.Target || body.Identity != "" || body.Filesystem != "" {
			return errors.New("A mounted filesystem path is required.")
		}
	case "configure-storage":
		if !strings.HasPrefix(body.Target, "/dev/") || len(body.Target) > 256 || filepath.Clean(body.Target) != body.Target || !validStorageIdentity(body.Identity) || body.Filesystem == "/" || len(body.Filesystem) > 1024 || !filepath.IsAbs(body.Filesystem) || filepath.Clean(body.Filesystem) != body.Filesystem {
			return errors.New("A physical device, stable identity, and mounted data-pool path are required.")
		}
	default:
		if body.Target != "" || body.Identity != "" || body.Filesystem != "" {
			return errors.New("This operation does not accept a storage target.")
		}
	}
	return nil
}

func (h adminHandler) prepareStorageMaintenance(w http.ResponseWriter, r *http.Request, target string) (required, ready bool) {
	if h.deps.Maintenance == nil {
		writeError(w, http.StatusServiceUnavailable, "File-reference checks are unavailable.")
		return false, false
	}
	status, err := h.deps.Maintenance.StorageStatus(r.Context())
	var media struct {
		Directory string `json:"directory"`
		State     string `json:"state"`
	}
	if err != nil || json.Unmarshal(status, &media) != nil || media.Directory == "" {
		writeError(w, http.StatusServiceUnavailable, "File-reference checks are unavailable.")
		return false, false
	}
	required = media.Directory == target || strings.HasPrefix(media.Directory, target+"/")
	if required && (media.State == "checking" || media.State == "repairing") {
		writeError(w, http.StatusConflict, "A file-copy operation is already running.")
		return false, false
	}
	return required, true
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
