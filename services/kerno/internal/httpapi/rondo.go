package httpapi

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
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
	users  UserStore
	deps   RondoDependencies
}

func mountRondo(router chi.Router, verify VerifyFunc, users UserStore, deps RondoDependencies) {
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
	})
}

func (h rondoHandler) actor(w http.ResponseWriter, r *http.Request) (postgres.User, bool) {
	claims, ok := authenticate(w, r, h.verify)
	if !ok {
		return postgres.User{}, false
	}
	actor, err := h.users.BySubject(r.Context(), claims.Subject)
	if postgres.IsNotFound(err) {
		writeError(w, http.StatusConflict, "Start a Kaordo account session before using Rondo.")
		return postgres.User{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load your account.")
		return postgres.User{}, false
	}
	return actor, true
}

func rondoError(w http.ResponseWriter, err error) {
	switch {
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

func rondoName(value string, maximum int) bool {
	count := utf8.RuneCountInString(value)
	if count < 1 || count > maximum {
		return false
	}
	for _, letter := range value {
		if unicode.IsControl(letter) {
			return false
		}
	}
	return true
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
	if !decodeBody(w, r, &input) {
		return
	}
	input.Name, input.Description = strings.TrimSpace(input.Name), strings.TrimSpace(input.Description)
	if !rondoName(input.Name, 100) ||
		utf8.RuneCountInString(input.Description) > 500 ||
		strings.ContainsRune(input.Name+input.Description, 0) ||
		(input.Access != "public" && input.Access != "private") {
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
	}
	if !decodeBody(w, r, &input) {
		return
	}
	if !ligoID(id) || !ligoID(input.UserID) {
		writeError(w, http.StatusBadRequest, "Invalid server or account ID.")
		return
	}
	item, err := h.deps.Store.Invite(r.Context(), actor.ID, id, input.UserID)
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
	if h.deps.Voice != nil {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
		defer cancel()
		var removals sync.WaitGroup
		limit := make(chan struct{}, 8)
	removeChannels:
		for _, channel := range channels {
			select {
			case limit <- struct{}{}:
			case <-ctx.Done():
				break removeChannels
			}
			removals.Add(1)
			go func() {
				defer removals.Done()
				defer func() { <-limit }()
				if err := h.deps.Voice.Remove(ctx, channel, actor.ID); err != nil {
					log.Printf("Rondo voice removal failed for channel %s: %v", channel, err)
				}
			}()
		}
		removals.Wait()
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h rondoHandler) createChannel(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	var input struct {
		Name string `json:"name"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if !ligoID(id) || !rondoName(input.Name, 80) {
		writeError(w, http.StatusBadRequest, "Choose a channel name up to 80 characters.")
		return
	}
	item, err := h.deps.Store.CreateChannel(r.Context(), actor.ID, id, input.Name)
	if err != nil {
		rondoError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (h rondoHandler) voiceToken(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !ligoID(id) {
		writeError(w, http.StatusBadRequest, "Invalid channel ID.")
		return
	}
	channel, err := h.deps.Store.VoiceChannel(r.Context(), actor.ID, id)
	if err != nil {
		rondoError(w, err)
		return
	}
	if h.deps.Voice == nil || h.deps.VoiceURL == "" {
		writeError(w, http.StatusServiceUnavailable, "Voice is not configured on this server.")
		return
	}
	token, err := h.deps.Voice.JoinToken(channel.ID, actor.ID, actor.DisplayName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not start voice.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"serverUrl": h.deps.VoiceURL, "participantToken": token})
}
