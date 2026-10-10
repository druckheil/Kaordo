package httpapi

// Proxies host facts, desired state and operations to agents with admin authorization and audit
import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/druckheil/Kaordo/services/kerno/internal/invalid"
	"github.com/go-chi/chi/v5"
)

const hostBodyLimit = 64 << 10

func mountAdminHosts(r chi.Router, hosts *admin.Hosts, alerts *admin.AlertDelivery) {
	if hosts == nil {
		return
	}
	h := hostsHandler{hosts: hosts, alerts: alerts}
	r.Get("/hosts", h.list)
	r.Get("/hosts/{host}", h.facts)
	r.Post("/hosts/{host}/state/plan", h.plan)
	r.Put("/hosts/{host}/state", h.apply)
	r.Get("/hosts/{host}/operations", h.operations)
	r.Post("/hosts/{host}/operations", h.startCheck)
	r.Get("/hosts/{host}/operations/{operation}", h.operation)
	r.Post("/hosts/{host}/operations/{operation}/cancel", h.cancel)
	r.Get("/hosts/{host}/usage", h.usage)
	r.Post("/hosts/{host}/usage/measure", h.measureUsage)
	if alerts != nil {
		r.Get("/hosts/{host}/alerts", h.listAlerts)
		r.Post("/hosts/{host}/alerts/test", h.testAlerts)
	}
}

type hostsHandler struct {
	hosts  *admin.Hosts
	alerts *admin.AlertDelivery
}

func (h hostsHandler) list(w http.ResponseWriter, _ *http.Request) {
	items := []map[string]string{}
	for _, id := range h.hosts.IDs() {
		items = append(items, map[string]string{"id": id})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h hostsHandler) facts(w http.ResponseWriter, r *http.Request) {
	result, err := h.hosts.Facts(r.Context(), chi.URLParam(r, "host"))
	writeHostResult(w, result, err)
}

func (h hostsHandler) plan(w http.ResponseWriter, r *http.Request) {
	var document json.RawMessage
	if !decodeHostBody(w, r, &document) {
		return
	}
	result, err := h.hosts.Plan(r.Context(), chi.URLParam(r, "host"), document)
	writeHostResult(w, result, err)
}

func (h hostsHandler) apply(w http.ResponseWriter, r *http.Request) {
	var change admin.StateChange
	if !decodeHostBody(w, r, &change) {
		return
	}
	result, err := h.hosts.Apply(r.Context(), adminActor(r).ID, chi.URLParam(r, "host"), change)
	writeHostResult(w, result, err)
}

func (h hostsHandler) operations(w http.ResponseWriter, r *http.Request) {
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit < 1 || limit > 200 {
		limit = 50
	}
	result, err := h.hosts.Operations(r.Context(), chi.URLParam(r, "host"), limit)
	writeHostResult(w, result, err)
}

func (h hostsHandler) startCheck(w http.ResponseWriter, r *http.Request) {
	var check admin.CheckRequest
	if !decodeHostBody(w, r, &check) {
		return
	}
	result, err := h.hosts.StartCheck(r.Context(), adminActor(r).ID, chi.URLParam(r, "host"), check)
	writeHostResult(w, result, err)
}

func (h hostsHandler) operation(w http.ResponseWriter, r *http.Request) {
	result, err := h.hosts.Operation(r.Context(), chi.URLParam(r, "host"), chi.URLParam(r, "operation"))
	writeHostResult(w, result, err)
}

func (h hostsHandler) cancel(w http.ResponseWriter, r *http.Request) {
	result, err := h.hosts.Cancel(r.Context(), adminActor(r).ID, chi.URLParam(r, "host"), chi.URLParam(r, "operation"))
	writeHostResult(w, result, err)
}

func (h hostsHandler) usage(w http.ResponseWriter, r *http.Request) {
	result, err := h.hosts.Usage(r.Context(), chi.URLParam(r, "host"), r.URL.Query().Get("window"))
	writeHostResult(w, result, err)
}

func (h hostsHandler) measureUsage(w http.ResponseWriter, r *http.Request) {
	result, err := h.hosts.MeasureUsage(r.Context(), chi.URLParam(r, "host"))
	writeHostResult(w, result, err)
}

func (h hostsHandler) listAlerts(w http.ResponseWriter, r *http.Request) {
	result, err := h.alerts.Alerts(r.Context(), chi.URLParam(r, "host"))
	writeHostResult(w, result, err)
}

func (h hostsHandler) testAlerts(w http.ResponseWriter, r *http.Request) {
	result, err := h.alerts.SendTest(r.Context(), adminActor(r).ID, chi.URLParam(r, "host"))
	if err != nil {
		writeHostResult(w, nil, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func decodeHostBody(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, hostBodyLimit))
	decoder.DisallowUnknownFields()
	var extra any
	if decoder.Decode(target) != nil || !errors.Is(decoder.Decode(&extra), io.EOF) {
		writeError(w, http.StatusBadRequest, "Invalid request body.")
		return false
	}
	return true
}

// writeHostResult passes an agent's refusal through with its status and operator-facing message
func writeHostResult(w http.ResponseWriter, result json.RawMessage, err error) {
	var refusal *admin.AgentError
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, result)
	case errors.Is(err, admin.ErrUnknownHost):
		writeError(w, http.StatusNotFound, "This host is not registered.")
	case errors.As(err, &refusal) && refusal.Status >= 400 && refusal.Status < 500:
		writeError(w, refusal.Status, refusal.Message)
	case errors.Is(err, admin.ErrInvalidOperation):
		if _, ok := invalid.Message(err); ok {
			writeInvalid(w, err)
			return
		}
		writeError(w, http.StatusBadRequest, "The request is invalid.")
	default:
		slog.Error("host agent request failed", "err", err)
		writeError(w, http.StatusServiceUnavailable, "The host agent is unavailable.")
	}
}
