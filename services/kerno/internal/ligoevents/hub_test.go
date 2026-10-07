package ligoevents

// Verifies scoped activity hints, backpressure and owned listener shutdown
import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestHubCloseJoinsListenerAndIsConcurrentSafe(t *testing.T) {
	hub := New(t.Context(), "invalid-dsn", nil)
	var pending sync.WaitGroup
	for range 16 {
		pending.Go(hub.Close)
	}
	finished := make(chan struct{})
	go func() { pending.Wait(); close(finished) }()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("listener did not stop")
	}
	select {
	case <-hub.done:
	default:
		t.Fatal("Close returned before the worker stopped")
	}
}

func TestReconnectWaitStopsOnCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if waitForReconnect(ctx) {
		t.Fatal("cancelled listener retried")
	}
}

func TestHubScopesHintsAndResynchronizesSlowListeners(t *testing.T) {
	hub := &Hub{listeners: make(map[string]map[chan string]struct{})}
	alice, leaveAlice := hub.Subscribe("alice")
	bob, leaveBob := hub.Subscribe("bob")
	defer leaveAlice()
	defer leaveBob()

	hub.publish("alice", "conversation-1")
	if got := <-alice; got != "conversation-1" {
		t.Fatalf("Alice received %q", got)
	}
	select {
	case got := <-bob:
		t.Fatalf("Bob received another user's hint: %q", got)
	default:
	}

	for range 17 {
		hub.publish("alice", "conversation-2")
	}
	for len(alice) > 1 {
		<-alice
	}
	if got := <-alice; got != "" {
		t.Fatalf("slow listener was not told to resynchronize: %q", got)
	}
	hub.resync()
	if got := <-bob; got != "" {
		t.Fatalf("reconnect did not resynchronize Bob: %q", got)
	}
}
