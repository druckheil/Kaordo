package httpapi

// Authorizes and audits host journal retention changes before privileged execution
import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"slices"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
)

type adminJournalSystem interface {
	SetLogRetention(context.Context, int) (json.RawMessage, error)
}

func (h adminHandler) logRetention(w http.ResponseWriter, r *http.Request) {
	system, ok := h.deps.System.(adminJournalSystem)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "Journal retention controls are unavailable.")
		return
	}
	var body struct {
		Days   *int   `json:"retentionDays"`
		Reason string `json:"reason"`
	}
	if !decodeAdminBody(w, r, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if body.Days == nil || !slices.Contains([]int{0, 1, 7, 14, 30, 90}, *body.Days) || !admin.ValidReason(body.Reason, 10, 500) {
		writeError(w, http.StatusBadRequest, "Select a supported retention period and a reason of 10 to 500 characters.")
		return
	}
	actorID := adminActor(r).ID
	record := func(state string) error {
		return h.deps.Store.Record(r.Context(), actorID, "", "log.retention."+state, body.Reason, map[string]any{"retentionDays": *body.Days, "status": state})
	}
	if err := record("requested"); err != nil {
		adminFailure(w, err)
		return
	}
	result, err := system.SetLogRetention(r.Context(), *body.Days)
	if err != nil {
		_ = record("failed")
		adminFailure(w, err)
		return
	}
	if err := record("completed"); err != nil {
		slog.Error("Regado journal outcome audit failed", "err", err)
	}
	writeJSON(w, http.StatusOK, result)
}
