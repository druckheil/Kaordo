package agent

// Accepts strict partition previews and explicitly confirmed background layout changes
import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

func layoutHandler(run commandRunner, monitor *replicationMonitor, apply bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		decoder.DisallowUnknownFields()
		var request layoutRequest
		var extra any
		if decoder.Decode(&request) != nil || !errors.Is(decoder.Decode(&extra), io.EOF) {
			http.Error(w, "invalid layout request", http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		if !apply {
			plan, err := previewStoragePlan(ctx, run, request)
			if err != nil {
				http.Error(w, "device identity or layout discovery failed; refresh the inventory", http.StatusConflict)
				return
			}
			respond(w, plan, nil)
			return
		}
		if err := monitor.startLayout(ctx, run, request); err != nil {
			http.Error(w, "layout changed, requires migration, or another operation is active", http.StatusConflict)
			return
		}
		respond(w, map[string]any{"action": "apply-layout", "target": request.Device, "accepted": true, "output": "Device layout queued. Progress appears on its device card."}, nil)
	}
}
