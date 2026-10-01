package ligoevents

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/jackc/pgx/v5"
)

// Hub distributes database change hints. Message bodies never travel through
// NOTIFY; every client reloads authorized state from Kerno.
type Hub struct {
	store     ligo.Store
	mu        sync.Mutex
	listeners map[string]map[chan string]struct{}
}

func New(ctx context.Context, dsn string, store ligo.Store) *Hub {
	hub := &Hub{store: store, listeners: make(map[string]map[chan string]struct{})}
	go hub.run(ctx, dsn)
	return hub
}

func (hub *Hub) Subscribe(userID string) (<-chan string, func()) {
	ch := make(chan string, 16)
	hub.mu.Lock()
	if hub.listeners[userID] == nil {
		hub.listeners[userID] = make(map[chan string]struct{})
	}
	hub.listeners[userID][ch] = struct{}{}
	hub.mu.Unlock()
	return ch, func() {
		hub.mu.Lock()
		delete(hub.listeners[userID], ch)
		if len(hub.listeners[userID]) == 0 {
			delete(hub.listeners, userID)
		}
		close(ch)
		hub.mu.Unlock()
	}
}

func (hub *Hub) publish(userID, conversationID string) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	for ch := range hub.listeners[userID] {
		select {
		case ch <- conversationID:
		default:
			// A slow stream must resynchronize instead of silently losing a hint.
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- "":
			default:
			}
		}
	}
}

func (hub *Hub) resync() {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	for _, listeners := range hub.listeners {
		for ch := range listeners {
			select {
			case ch <- "":
			default:
			}
		}
	}
}

func (hub *Hub) run(ctx context.Context, dsn string) {
	for ctx.Err() == nil {
		conn, err := pgx.Connect(ctx, dsn)
		if err == nil {
			_, err = conn.Exec(ctx, "LISTEN ligo_activity")
			if err == nil {
				hub.resync()
				for ctx.Err() == nil {
					notice, waitErr := conn.WaitForNotification(ctx)
					if waitErr != nil {
						err = waitErr
						break
					}
					ids, lookupErr := hub.store.MemberIDs(ctx, notice.Payload)
					if lookupErr != nil {
						hub.resync()
						continue
					}
					for _, userID := range ids {
						hub.publish(userID, notice.Payload)
					}
				}
			}
			_ = conn.Close(context.Background())
		}
		if ctx.Err() != nil {
			return
		}
		log.Printf("Ligo event listener reconnecting: %v", err)
		hub.resync()
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}
