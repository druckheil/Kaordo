package httpapi

// Issues Rondo voice tickets and removes departed voice memberships
import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
)

func (h rondoHandler) removeVoiceMemberships(parent context.Context, userID string, channels []string) {
	if h.deps.Voice == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), 5*time.Second)
	defer cancel()

	var removals sync.WaitGroup
	limit := make(chan struct{}, 8)
	for _, channelID := range channels {
		if !acquireVoiceRemovalSlot(ctx, limit) {
			break
		}
		removals.Add(1)
		go h.removeVoiceMember(ctx, &removals, limit, channelID, userID)
	}
	removals.Wait()
}

func acquireVoiceRemovalSlot(ctx context.Context, limit chan struct{}) bool {
	select {
	case limit <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}

func (h rondoHandler) removeVoiceMember(ctx context.Context, removals *sync.WaitGroup, limit chan struct{}, channelID, userID string) {
	defer removals.Done()
	defer func() { <-limit }()
	if err := h.deps.Voice.Remove(ctx, channelID, userID); err != nil {
		log.Printf("Rondo voice removal failed for channel %s: %v", channelID, err)
	}
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
