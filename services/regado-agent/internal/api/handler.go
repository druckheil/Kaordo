package api

// Maps the host service onto the agent socket's HTTP routes with explicit error statuses
import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/integrity"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
)

const bodyLimit = 64 << 10

// NewHandler serves the declarative host API and passes telemetry, journal and service routes to system.
func NewHandler(service *Service, system http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /host", func(w http.ResponseWriter, r *http.Request) {
		facts, err := service.Facts(r.Context())
		respond(w, facts, err)
	})
	mux.HandleFunc("POST /state/plan", func(w http.ResponseWriter, r *http.Request) {
		var document state.Document
		if !decode(w, r, &document) {
			return
		}
		plan, err := service.Plan(r.Context(), document)
		respond(w, plan, err)
	})
	mux.HandleFunc("PUT /state", func(w http.ResponseWriter, r *http.Request) {
		var change Change
		if !decode(w, r, &change) {
			return
		}
		result, err := service.Apply(r.Context(), change)
		respond(w, result, err)
	})
	mux.HandleFunc("GET /operations", func(w http.ResponseWriter, r *http.Request) {
		limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
		if err != nil || limit < 1 || limit > 200 {
			limit = 50
		}
		operations, err := service.Operations.List(limit)
		respond(w, map[string]any{"items": operations}, err)
	})
	mux.HandleFunc("GET /alerts", func(w http.ResponseWriter, r *http.Request) {
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		report, err := service.AlertReport(max(0, after))
		respond(w, report, err)
	})
	mux.HandleFunc("POST /operations", func(w http.ResponseWriter, r *http.Request) {
		var check CheckRequest
		if !decode(w, r, &check) {
			return
		}
		started, err := service.StartCheck(r.Context(), check)
		respond(w, started, err)
	})
	mux.HandleFunc("GET /operations/{id}", func(w http.ResponseWriter, r *http.Request) {
		record, err := service.Operations.Get(r.PathValue("id"))
		respond(w, record, err)
	})
	mux.HandleFunc("POST /operations/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		cancelled, err := service.Operations.Cancel(r.PathValue("id"))
		respond(w, cancelled, err)
	})
	if system != nil {
		mux.Handle("/", system)
	}
	return mux
}

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, bodyLimit))
	decoder.DisallowUnknownFields()
	var extra any
	if decoder.Decode(target) != nil || !errors.Is(decoder.Decode(&extra), io.EOF) {
		writeError(w, http.StatusBadRequest, "The request body is not valid JSON for this route.")
		return false
	}
	return true
}

func respond(w http.ResponseWriter, value any, err error) {
	if err != nil {
		status := statusOf(err)
		message := err.Error()
		if status == http.StatusBadGateway {
			slog.Error("agent request failed", "err", err)
			message = "The host could not complete the request."
		}
		writeError(w, status, message)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func statusOf(err error) int {
	switch {
	case errors.Is(err, state.ErrInvalid), errors.Is(err, ErrNotReady), errors.Is(err, ErrUnconfirmed),
		errors.Is(err, integrity.ErrNothingToCheck):
		return http.StatusUnprocessableEntity
	case errors.Is(err, state.ErrConflict), errors.Is(err, ErrBusy), errors.Is(err, operation.ErrNotCancellable),
		errors.Is(err, ErrCheckRunning):
		return http.StatusConflict
	case errors.Is(err, operation.ErrNotFound), errors.Is(err, state.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrIncomplete), errors.Is(err, ErrUnknownCheck):
		return http.StatusBadRequest
	default:
		return http.StatusBadGateway
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
