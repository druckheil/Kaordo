// Package ligoevents relays PostgreSQL conversation notifications to server-sent event subscribers.
package ligoevents

// Distributes Ligo activity hints to subscribed user streams
import (
	"context"
	"log"
	"sync"
	"time"

	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

const reconnectDelay = 2 * time.Second

type memberStore interface {
	MemberIDs(context.Context, string) ([]string, error)
}

// Hub distributes database change hints. Message bodies never travel through
// NOTIFY; every client reloads authorized state from Kerno.
type Hub struct {
	store     memberStore
	mu        sync.Mutex
	listeners map[string]map[chan string]struct{}
	cancel    context.CancelFunc
	done      chan struct{}
}

func New(ctx context.Context, dsn string, store memberStore) *Hub {
	ctx, cancel := context.WithCancel(ctx)
	hub := &Hub{store: store, listeners: make(map[string]map[chan string]struct{}), cancel: cancel, done: make(chan struct{})}
	go func() { defer close(hub.done); hub.run(ctx, dsn) }()
	return hub
}

// Close stops the listener before its store and database dependencies are released
func (hub *Hub) Close() {
	if hub.cancel == nil {
		return
	}
	hub.cancel()
	<-hub.done
}

func (hub *Hub) Subscribe(userID string) (<-chan string, func()) {
	ch := make(chan string, 16)
	hub.mu.Lock()
	if hub.listeners == nil {
		hub.listeners = make(map[string]map[chan string]struct{})
	}
	if hub.listeners[userID] == nil {
		hub.listeners[userID] = make(map[chan string]struct{})
	}
	hub.listeners[userID][ch] = struct{}{}
	hub.mu.Unlock()
	return ch, func() { hub.unsubscribe(userID, ch) }
}

func (hub *Hub) unsubscribe(userID string, ch chan string) {
	hub.mu.Lock()
	defer hub.mu.Unlock()

	listeners := hub.listeners[userID]
	if _, subscribed := listeners[ch]; !subscribed {
		return
	}
	delete(listeners, ch)
	if len(listeners) == 0 {
		delete(hub.listeners, userID)
	}
	close(ch)
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
		err := hub.listen(ctx, dsn)
		if ctx.Err() != nil {
			return
		}
		log.Printf("Ligo event listener reconnecting: %v", err)
		hub.resync()
		if !waitForReconnect(ctx) {
			return
		}
	}
}

func (hub *Hub) listen(ctx context.Context, dsn string) error {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = conn.Close(closeCtx)
	}()

	if err := subscribeToActivity(ctx, conn); err != nil {
		return err
	}
	hub.resync()

	for {
		notice, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		hub.forwardActivity(ctx, notice.Payload)
	}
}

func subscribeToActivity(ctx context.Context, conn *pgx.Conn) error {
	statement := jetpg.RawStatement("LISTEN ligo_activity")
	query, args := statement.Sql()
	_, err := conn.Exec(ctx, query, args...)
	return err
}

func (hub *Hub) forwardActivity(ctx context.Context, conversationID string) {
	userIDs, err := hub.store.MemberIDs(ctx, conversationID)
	if err != nil {
		hub.resync()
		return
	}
	for _, userID := range userIDs {
		hub.publish(userID, conversationID)
	}
}

func waitForReconnect(ctx context.Context) bool {
	timer := time.NewTimer(reconnectDelay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
