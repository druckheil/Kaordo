package httpapi

// Handles explicitly authorized and audited content access cases
import (
	"net/http"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/mediaauth"
	"github.com/go-chi/chi/v5"
)

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
	if !fluo.ValidID(body.TargetUserID) || !admin.ValidReason(body.Reason, 20, 500) {
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

func (h adminHandler) signCaseMedia(page *admin.ContentPage) error {
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
