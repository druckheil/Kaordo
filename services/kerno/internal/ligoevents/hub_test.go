package ligoevents

import "testing"

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
