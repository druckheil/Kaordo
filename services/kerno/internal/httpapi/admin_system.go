package httpapi

// Reads system state and metrics and coordinates audited host actions
import (
	"encoding/json"
	"errors"
	"net/http"

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
	if !admin.ValidSystemAction(action) {
		writeError(w, http.StatusBadRequest, "Unsupported system action.")
		return
	}
	var body systemActionInput
	if !decodeAdminBody(w, r, &body) {
		return
	}
	command := admin.SystemAction{
		Name: action, Reason: body.Reason,
		Request: admin.ActionRequest{Target: body.Target, Identity: body.Identity, Filesystem: body.Filesystem},
	}
	result, err := h.operations.Execute(r.Context(), adminActor(r).ID, command)
	if err != nil {
		switch {
		case errors.Is(err, admin.ErrInvalidOperation):
			writeInvalid(w, err)
		case errors.Is(err, admin.ErrSystemUnavailable):
			writeError(w, http.StatusServiceUnavailable, "System agent is unavailable.")
		case errors.Is(err, admin.ErrFileReferencesUnavailable):
			writeError(w, http.StatusServiceUnavailable, "File-reference checks are unavailable.")
		case errors.Is(err, admin.ErrStorageBusy):
			writeError(w, http.StatusConflict, "A file-copy operation is already running.")
		default:
			adminFailure(w, err)
		}
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}

type systemActionInput struct {
	Reason     string `json:"reason"`
	Target     string `json:"target"`
	Identity   string `json:"identity"`
	Filesystem string `json:"filesystem"`
}
