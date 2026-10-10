package httpapi

// Handles Ligo conversation, message, media, receipt, and event requests
import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/go-chi/chi/v5"
)

type LigoEvents interface {
	Subscribe(userID string) (<-chan string, func())
}

type LigoMediaVerifier interface {
	ValidateLigo(context.Context, string, string) (ligo.Media, error)
	Purge(context.Context, string) error
}

type LigoDependencies struct {
	Store        ligo.Store
	Events       LigoEvents
	Media        LigoMediaVerifier
	MediaBaseURL string
	MediaSignKey []byte
}

type ligoHandler struct {
	verify VerifyFunc
	users  account.Store
	deps   LigoDependencies
}

const maxLigoAttachments = 8

func mountLigo(router chi.Router, verify VerifyFunc, users account.Store, deps LigoDependencies) {
	h := ligoHandler{verify: verify, users: users, deps: deps}
	router.Route("/v1/ligo", func(r chi.Router) {
		r.Get("/users", h.searchUsers)
		r.Get("/conversations", h.listConversations)
		r.Post("/conversations", h.createConversation)
		r.Get("/conversations/{id}", h.getConversation)
		r.Post("/conversations/{id}/members", h.addMembers)
		r.Get("/conversations/{id}/messages", h.listMessages)
		r.Post("/conversations/{id}/messages", h.send)
		r.Patch("/conversations/{id}/messages/{messageId}", h.editMessage)
		r.Delete("/conversations/{id}/messages/{messageId}", h.deleteMessage)
		r.Put("/conversations/{id}/messages/{messageId}/reaction", h.setReaction)
		r.Put("/conversations/{id}/delivered", h.markDelivered)
		r.Put("/conversations/{id}/read", h.markRead)
		r.Get("/events", h.events)
	})
}

func (h ligoHandler) actor(w http.ResponseWriter, r *http.Request) (account.User, bool) {
	return authenticatedActor(w, r, h.verify, h.users, "Start a Kaordo account session before using Ligo.")
}

func ligoError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, encryption.ErrInvalid):
		writeError(w, http.StatusBadRequest, "Encrypted content could not be authenticated.")
	case errors.Is(err, encryption.ErrNotFound):
		writeError(w, http.StatusConflict, "A recipient needs to open Kaordo on a device before encrypted content can be shared.")
	case errors.Is(err, encryption.ErrConflict):
		writeError(w, http.StatusConflict, "The encryption audience changed. Reload and try again.")
	case errors.Is(err, ligo.ErrNotFound):
		writeError(w, http.StatusNotFound, "Conversation or account not found.")
	case errors.Is(err, ligo.ErrForbidden):
		writeError(w, http.StatusForbidden, "You cannot change this conversation.")
	case errors.Is(err, ligo.ErrInvalid):
		writeError(w, http.StatusBadRequest, "Invalid conversation request.")
	case errors.Is(err, ligo.ErrMediaOwner):
		writeError(w, http.StatusBadRequest, "An attachment is unavailable or not yours.")
	case errors.Is(err, ligo.ErrRateLimited):
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "Sending too quickly. Try again in a minute.")
	default:
		writeError(w, http.StatusInternalServerError, "Ligo could not complete the request.")
	}
}

func ligoID(id string) bool { return fluo.ValidID(id) }

func validIDs(ids []string, maximum int) bool {
	if len(ids) == 0 || len(ids) > maximum {
		return false
	}
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if !ligoID(id) {
			return false
		}
		if _, duplicate := seen[id]; duplicate {
			return false
		}
		seen[id] = struct{}{}
	}
	return true
}

func parseLigoPageLimit(w http.ResponseWriter, raw string) (int, bool) {
	if raw == "" {
		return 30, true
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 50 {
		writeError(w, http.StatusBadRequest, "Limit must be between 1 and 50.")
		return 0, false
	}
	return limit, true
}
