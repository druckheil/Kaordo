package httpapi

// Handles Fluo post, media, reaction, follow, and feed requests
import (
	"context"
	"errors"
	"net/http"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/go-chi/chi/v5"
)

type MediaVerifier interface {
	Validate(context.Context, string, string) (fluo.Media, error)
	Purge(context.Context, string) error
}

type FluoDependencies struct {
	Store         fluo.Store
	Notifications fluo.NotificationStore
	Settings      fluo.SettingsStore
	Media         MediaVerifier
	MediaBaseURL  string
	MediaSignKey  []byte
}

type fluoHandler struct {
	verify VerifyFunc
	users  account.Store
	deps   FluoDependencies
}

const (
	maxPostAttachments       = 4
	invalidVisibilityMessage = "Visibility must be public or private."
)

func mountFluo(router chi.Router, verify VerifyFunc, users account.Store, deps FluoDependencies) {
	h := fluoHandler{verify: verify, users: users, deps: deps}
	router.Get("/v1/internal/media/{id}/referenced", h.mediaReferenced)
	router.Route("/v1/fluo", func(r chi.Router) {
		if deps.Settings != nil {
			r.Get("/settings", h.settings)
			r.Patch("/settings", h.updateSettings)
		}
		if deps.Notifications != nil {
			r.Get("/notifications", h.notifications)
			r.Get("/notifications/unread-count", h.notificationSummary)
			r.Put("/notifications/{id}/read", h.readNotification)
			r.Put("/notifications/read", h.readNotifications)
		}
		r.Get("/posts", h.list)
		r.Post("/posts", h.create)
		r.Put("/posts/{id}/saved", h.savePost)
		r.Delete("/posts/{id}/saved", h.unsavePost)
		r.Get("/posts/{id}", h.get)
		r.Get("/posts/{id}/thread", h.thread)
		r.Patch("/posts/{id}", h.setVisibility)
		r.Delete("/posts/{id}", h.delete)
		r.Get("/posts/{id}/comments", h.comments)
		r.Put("/posts/{id}/reaction", h.react)
		r.Delete("/posts/{id}/reaction", h.unreact)
		r.Put("/users/{id}/follow", h.follow)
		r.Delete("/users/{id}/follow", h.unfollow)
	})
}

func (h fluoHandler) actor(w http.ResponseWriter, r *http.Request) (account.User, bool) {
	return authenticatedActor(w, r, h.verify, h.users, "Start a Kaordo account session before using Fluo.")
}

func fluoError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, fluo.ErrNotFound):
		writeError(w, http.StatusNotFound, "Post or account not found.")
	case errors.Is(err, fluo.ErrInvalidRelation):
		writeError(w, http.StatusNotFound, "The referenced post is unavailable.")
	case errors.Is(err, fluo.ErrInvalidVisibility):
		writeError(w, http.StatusBadRequest, invalidVisibilityMessage)
	case errors.Is(err, fluo.ErrInvalidSettings):
		writeError(w, http.StatusBadRequest, "Choose a valid notification or privacy setting.")
	case errors.Is(err, fluo.ErrPrivateParent):
		writeError(w, http.StatusBadRequest, "A reply cannot be public while its parent is private.")
	case errors.Is(err, fluo.ErrSelfFollow):
		writeError(w, http.StatusBadRequest, "You cannot follow yourself.")
	case errors.Is(err, fluo.ErrRateLimited):
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "Posting too quickly. Try again in a minute.")
	case errors.Is(err, fluo.ErrMediaOwner):
		writeError(w, http.StatusBadRequest, "An attachment is unavailable or not yours.")
	default:
		writeError(w, http.StatusInternalServerError, "Fluo could not complete the request.")
	}
}
