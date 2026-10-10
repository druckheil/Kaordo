package httpapi

// Handles Ligo receipts and membership scoped event streams
import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

func (h ligoHandler) markDelivered(w http.ResponseWriter, r *http.Request) {
	h.markReceipt(w, r, false)
}

func (h ligoHandler) markRead(w http.ResponseWriter, r *http.Request) {
	h.markReceipt(w, r, true)
}

func (h ligoHandler) markReceipt(w http.ResponseWriter, r *http.Request, read bool) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	var input struct {
		MessageID string `json:"messageId"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	if !ligoID(id) || !ligoID(input.MessageID) {
		writeError(w, http.StatusBadRequest, "Invalid conversation or message ID.")
		return
	}
	var err error
	if read {
		err = h.deps.Store.MarkRead(r.Context(), actor.ID, id, input.MessageID)
	} else {
		err = h.deps.Store.MarkDelivered(r.Context(), actor.ID, id, input.MessageID)
	}
	if err != nil {
		ligoError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (h ligoHandler) events(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	if h.deps.Events == nil {
		writeError(w, http.StatusServiceUnavailable, "Live updates are unavailable.")
		return
	}
	h.serveEvents(w, r, actor.ID)
}

func (h ligoHandler) serveEvents(w http.ResponseWriter, r *http.Request, userID string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")
	ch, unsubscribe := h.deps.Events.Subscribe(userID)
	defer unsubscribe()
	_, _ = fmt.Fprint(w, "event: ready\ndata: {}\n\n")
	controller := http.NewResponseController(w)
	if controller.Flush() != nil {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	rotate := time.NewTimer(45 * time.Second)
	defer rotate.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-rotate.C:
			return // reconnect with a fresh access token
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": heartbeat\n\n")
		case id, open := <-ch:
			if !open {
				return
			}
			writeLigoActivityEvent(w, id)
		}
		if controller.Flush() != nil {
			return
		}
	}
}

func writeLigoActivityEvent(w http.ResponseWriter, conversationID string) {
	if conversationID == "" {
		_, _ = fmt.Fprint(w, "event: resync\ndata: {}\n\n")
		return
	}
	data, _ := json.Marshal(map[string]string{"conversationId": conversationID})
	_, _ = fmt.Fprintf(w, "event: update\ndata: %s\n\n", data)
}
