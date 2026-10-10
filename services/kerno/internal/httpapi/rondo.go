package httpapi

// Handles Rondo server, membership, channel, and voice requests
import (
	"context"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondo"
	"github.com/go-chi/chi/v5"
)

type RondoVoice interface {
	JoinToken(channelID, userID, displayName string) (string, error)
	Remove(context.Context, string, string) error
}

type RondoDependencies struct {
	Store    rondo.Store
	Voice    RondoVoice
	VoiceURL string
}

type rondoHandler struct {
	verify VerifyFunc
	users  account.Store
	deps   RondoDependencies
}

func mountRondo(router chi.Router, verify VerifyFunc, users account.Store, deps RondoDependencies) {
	h := rondoHandler{verify: verify, users: users, deps: deps}
	router.Route("/v1/rondo", func(r chi.Router) {
		r.Get("/servers", h.list)
		r.Get("/discover", h.discover)
		r.Post("/servers", h.create)
		r.Get("/servers/{id}", h.get)
		r.Post("/servers/{id}/join", h.join)
		r.Post("/servers/{id}/members", h.invite)
		r.Delete("/servers/{id}/membership", h.leave)
		r.Post("/servers/{id}/channels", h.createChannel)
		r.Post("/channels/{id}/voice-token", h.voiceToken)
		r.Get("/channels/{id}/voice-key", h.voiceKey)
		r.Put("/channels/{id}/voice-key", h.setVoiceKey)
	})
}

func (h rondoHandler) actor(w http.ResponseWriter, r *http.Request) (account.User, bool) {
	return authenticatedActor(w, r, h.verify, h.users, "Start a Kaordo account session before using Rondo.")
}

func rondoError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, encryption.ErrInvalid):
		writeError(w, http.StatusBadRequest, "Invalid encrypted server content.")
	case errors.Is(err, encryption.ErrNotFound):
		writeError(w, http.StatusConflict, "Each participant must open Kaordo once to set up device encryption.")
	case errors.Is(err, encryption.ErrConflict):
		writeError(w, http.StatusConflict, "Membership or encrypted content changed. Reload and try again.")
	case errors.Is(err, rondo.ErrNotFound):
		writeError(w, http.StatusNotFound, "Server, channel or account not found.")
	case errors.Is(err, rondo.ErrForbidden):
		writeError(w, http.StatusForbidden, "Server membership or ownership is required.")
	case errors.Is(err, rondo.ErrInvalid):
		writeError(w, http.StatusBadRequest, "Invalid server request.")
	case errors.Is(err, rondo.ErrConflict):
		writeError(w, http.StatusConflict, "A channel with this name already exists.")
	case errors.Is(err, rondo.ErrLimit):
		writeError(w, http.StatusConflict, "This server or account has reached its current capacity.")
	default:
		writeError(w, http.StatusInternalServerError, "Rondo could not complete the request.")
	}
}

func rondoSearch(w http.ResponseWriter, r *http.Request) (string, bool) {
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(search) > 80 || strings.ContainsRune(search, 0) {
		writeError(w, http.StatusBadRequest, "Search must be 80 characters or fewer.")
		return "", false
	}
	return search, true
}

func (h rondoHandler) list(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	search, ok := rondoSearch(w, r)
	if !ok {
		return
	}
	items, err := h.deps.Store.List(r.Context(), actor.ID, search)
	if err != nil {
		rondoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h rondoHandler) discover(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	if store, ok := h.deps.Store.(rondo.DiscoveryStore); ok {
		cursor := r.URL.Query().Get("cursor")
		if cursor != "" && !encryption.ValidID(cursor) {
			writeError(w, http.StatusBadRequest, "Invalid discovery cursor.")
			return
		}
		page, err := store.DiscoverPage(r.Context(), actor.ID, cursor)
		if err != nil {
			rondoError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, page)
		return
	}
	search, ok := rondoSearch(w, r)
	if !ok {
		return
	}
	items, err := h.deps.Store.Discover(r.Context(), actor.ID, search)
	if err != nil {
		rondoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h rondoHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input rondo.NewServer
	if !decodeBodyLimit(w, r, &input, 1<<20) {
		return
	}
	input.Name, input.Description = strings.TrimSpace(input.Name), strings.TrimSpace(input.Description)
	if !validNewServer(input) {
		writeError(w, http.StatusBadRequest, "Use a name up to 100 characters, a description up to 500 characters and public or private access.")
		return
	}
	item, err := h.deps.Store.Create(r.Context(), actor.ID, input)
	if err != nil {
		rondoError(w, err)
		return
	}
	w.Header().Set("Location", "/v1/rondo/servers/"+item.Server.ID)
	writeJSON(w, http.StatusCreated, item)
}

func validNewServer(input rondo.NewServer) bool {
	_, nameErr := encryption.ParseText(input.Name)
	_, channelErr := encryption.ParseText(input.General)
	return encryption.ValidID(input.ID) && encryption.ValidID(input.GeneralID) && nameErr == nil && channelErr == nil && input.Description == "" &&
		(input.Access == "public" || input.Access == "private")
}

func (h rondoHandler) get(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !ligoID(id) {
		writeError(w, http.StatusBadRequest, "Invalid server ID.")
		return
	}
	item, err := h.deps.Store.Get(r.Context(), actor.ID, id)
	if err != nil {
		rondoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h rondoHandler) join(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !ligoID(id) {
		writeError(w, http.StatusBadRequest, "Invalid server ID.")
		return
	}
	item, err := h.deps.Store.Join(r.Context(), actor.ID, id)
	if err != nil {
		rondoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h rondoHandler) invite(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	var input struct {
		UserID string `json:"userId"`
		rondo.EncryptedMetadata
	}
	if !decodeBodyLimit(w, r, &input, 4<<20) {
		return
	}
	if !ligoID(id) || !ligoID(input.UserID) {
		writeError(w, http.StatusBadRequest, "Invalid server or account ID.")
		return
	}
	store, ok := h.encryptedStore(w)
	if !ok {
		return
	}
	item, err := store.InviteEncrypted(r.Context(), actor.ID, id, input.UserID, input.EncryptedMetadata)
	if err != nil {
		rondoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h rondoHandler) leave(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !ligoID(id) {
		writeError(w, http.StatusBadRequest, "Invalid server ID.")
		return
	}
	channels, err := h.deps.Store.Leave(r.Context(), actor.ID, id)
	if err != nil {
		rondoError(w, err)
		return
	}
	h.removeVoiceMemberships(r.Context(), actor.ID, channels)
	w.WriteHeader(http.StatusNoContent)
}

func (h rondoHandler) createChannel(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	var input struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if !decodeBodyLimit(w, r, &input, 1<<20) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	_, err := encryption.ParseText(input.Name)
	if !ligoID(id) || !encryption.ValidID(input.ID) || err != nil {
		writeError(w, http.StatusBadRequest, "Channel names must be encrypted on your device.")
		return
	}
	store, ok := h.encryptedStore(w)
	if !ok {
		return
	}
	item, err := store.CreateEncryptedChannel(r.Context(), actor.ID, id, input.ID, input.Name)
	if err != nil {
		rondoError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}
