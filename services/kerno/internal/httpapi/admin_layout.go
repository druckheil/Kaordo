package httpapi

// Authorizes partition previews and records explicit layout approvals before privileged changes
import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
)

type adminLayoutSystem interface {
	StorageLayout(context.Context, admin.LayoutRequest, bool) (json.RawMessage, error)
}

func (h adminHandler) storageLayout(w http.ResponseWriter, r *http.Request, apply bool) {
	system, ok := h.deps.System.(adminLayoutSystem)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "Partition management is unavailable.")
		return
	}
	var body struct {
		admin.LayoutRequest
		Reason string `json:"reason"`
	}
	if !decodeAdminBody(w, r, &body) {
		return
	}
	if !admin.ValidStorageDevice(body.Device, body.Identity) || body.SystemBytes < 0 || body.StorageBytes < 0 {
		writeError(w, http.StatusBadRequest, "A physical device, stable identity and nonnegative role sizes are required.")
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	_, fingerprintError := hex.DecodeString(body.Fingerprint)
	if apply && (!admin.ValidReason(body.Reason, 10, 500) || body.Confirmation != body.Device || len(body.Fingerprint) != 64 || fingerprintError != nil) {
		writeError(w, http.StatusBadRequest, "Confirm the reviewed device and provide a reason of 10 to 500 characters.")
		return
	}
	actor := adminActor(r).ID
	if apply {
		if err := h.deps.Store.Record(r.Context(), actor, "", "system.apply-layout", body.Reason, body.LayoutRequest); err != nil {
			adminFailure(w, err)
			return
		}
	}
	result, err := system.StorageLayout(r.Context(), body.LayoutRequest, apply)
	if err != nil {
		if apply {
			_ = h.deps.Store.Record(r.Context(), actor, "", "system.apply-layout.failed", body.Reason, body.LayoutRequest)
		}
		writeError(w, http.StatusConflict, "The device layout changed, requires migration, or another operation is active. Refresh its preview.")
		return
	}
	if apply {
		_ = h.deps.Store.Record(r.Context(), actor, "", "system.apply-layout.accepted", body.Reason, body.LayoutRequest)
		writeJSON(w, http.StatusAccepted, result)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
