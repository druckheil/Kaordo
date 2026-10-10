package httpapi

// Authorizes opaque diary records and signed downloads of encrypted attachments
import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/memoro"
	"github.com/druckheil/Kaordo/services/mediaauth"
	"github.com/go-chi/chi/v5"
)

type encryptedUploadValidator interface {
	ValidateLigo(context.Context, string, string) (ligo.Media, error)
}
type MemoroDependencies struct {
	Store        memoro.Store
	Media        encryptedUploadValidator
	MediaBaseURL string
	MediaSignKey []byte
}
type memoroHandler struct {
	verify VerifyFunc
	users  account.Store
	deps   MemoroDependencies
}

func mountMemoro(router chi.Router, verify VerifyFunc, users account.Store, deps MemoroDependencies) {
	h := memoroHandler{verify: verify, users: users, deps: deps}
	router.Route("/v1/memoro", func(r chi.Router) {
		r.Get("/month", h.month)
		r.Get("/days/{dayTag}", h.day)
		r.Put("/days/{dayTag}", h.saveDay)
	})
}
func (h memoroHandler) actor(w http.ResponseWriter, r *http.Request) (account.User, bool) {
	actor, ok := authenticatedActor(w, r, h.verify, h.users, "Start an account session before using Memoro.")
	if !ok {
		return actor, false
	}
	if tag := chi.URLParam(r, "dayTag"); tag != "" && !memoro.ValidTag(tag) {
		writeError(w, http.StatusBadRequest, "Use a valid encrypted date index.")
		return actor, false
	}
	return actor, true
}
func (h memoroHandler) month(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	items, err := h.deps.Store.Month(r.Context(), actor.ID, r.URL.Query().Get("tag"))
	memoroResponse(w, map[string]any{"items": items}, err)
}
func (h memoroHandler) day(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	day, err := h.deps.Store.Day(r.Context(), actor.ID, chi.URLParam(r, "dayTag"))
	if err == nil && day != nil {
		err = h.sign(day)
	}
	memoroResponse(w, map[string]any{"day": day}, err)
}
func (h memoroHandler) saveDay(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input memoro.DayUpdate
	if !decodeBodyLimit(w, r, &input, 3<<20) {
		return
	}
	if err := input.Validate(); err != nil {
		memoroResponse(w, nil, err)
		return
	}
	dayTag := chi.URLParam(r, "dayTag")
	previous, err := h.deps.Store.Day(r.Context(), actor.ID, dayTag)
	if err != nil {
		memoroResponse(w, nil, err)
		return
	}
	known := make(map[string]memoro.Media)
	if previous != nil {
		for _, item := range previous.Media {
			known[item.ID] = item
		}
	}
	media := make([]memoro.Media, 0, len(input.AttachmentIDs))
	for _, id := range input.AttachmentIDs {
		if item, exists := known[id]; exists {
			media = append(media, item)
			continue
		}
		if h.deps.Media == nil {
			writeError(w, http.StatusServiceUnavailable, "Media storage is unavailable.")
			return
		}
		item, err := h.deps.Media.ValidateLigo(r.Context(), r.Header.Get("Authorization"), id)
		if err != nil || item.Kind != "file" || item.MimeType != "application/octet-stream" {
			memoroResponse(w, nil, memoro.ErrMedia)
			return
		}
		media = append(media, memoro.Media{ID: id, Size: item.Size})
	}
	day, err := h.deps.Store.SaveDay(r.Context(), actor.ID, dayTag, input, media)
	if err == nil {
		err = h.sign(&day)
	}
	memoroResponse(w, day, err)
}
func (h memoroHandler) sign(day *memoro.Day) error {
	for i := range day.Media {
		url, err := mediaauth.SignedURL(h.deps.MediaBaseURL, day.Media[i].ID, time.Now().Add(9*time.Minute), h.deps.MediaSignKey)
		if err != nil {
			return err
		}
		day.Media[i].URL = url
	}
	return nil
}
func memoroResponse(w http.ResponseWriter, value any, err error) {
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, value)
	case errors.Is(err, memoro.ErrInvalid):
		writeError(w, http.StatusBadRequest, "The encrypted record is invalid or too large.")
	case errors.Is(err, memoro.ErrConflict):
		writeError(w, http.StatusConflict, "Your encrypted data changed on another device. Reload before saving. Your local draft has been kept.")
	case errors.Is(err, memoro.ErrMedia):
		writeError(w, http.StatusBadRequest, "An encrypted attachment is unavailable or not yours.")
	case errors.Is(err, memoro.ErrLimit):
		writeError(w, http.StatusConflict, "A month can contain up to 31 day records.")
	default:
		slog.Error("Memoro request failed", "err", err)
		writeError(w, http.StatusInternalServerError, "Memoro could not complete the request.")
	}
}
