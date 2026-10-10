package postgres

import (
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
)

// This measures the real paginated read path in a disposable database.
// Timings describe this machine, not a portable service-level guarantee.
func TestLigoReadCapacity(t *testing.T) {
	ctx, pool := testDatabase(t)
	users := NewUsers(pool)
	owner, err := users.Upsert(ctx, "ligo-capacity-owner", "ligocapacityowner", "Owner")
	if err != nil {
		t.Fatal(err)
	}
	peer, err := users.Upsert(ctx, "ligo-capacity-peer", "ligocapacitypeer", "Peer")
	if err != nil {
		t.Fatal(err)
	}
	store := NewLigo(pool)
	conversation, err := store.CreateConversation(ctx, owner.ID, ligo.NewConversation{
		Kind: "duo", ParticipantIDs: []string{peer.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		conversations := table.LigoConversations
		if _, err := jetExec(ctx, pool, conversations.DELETE().WHERE(conversations.ID.EQ(jetUUID(conversation.ID)))); err != nil {
			t.Errorf("remove capacity conversation: %v", err)
		}
		users := table.Users
		if _, err := jetExec(ctx, pool, users.DELETE().WHERE(users.ID.IN(jetUUID(owner.ID), jetUUID(peer.ID)))); err != nil {
			t.Errorf("remove capacity users: %v", err)
		}
	})
	messages := table.LigoMessages
	for start := 1; start <= 10000; start += 1000 {
		statement := messages.INSERT(messages.ConversationID, messages.SenderID, messages.ClientID, messages.Body)
		for number := start; number < start+1000 && number <= 10000; number++ {
			statement = statement.VALUES(jetUUID(conversation.ID), jetUUID(peer.ID), jetpg.RawString("uuidv7()"),
				jetpg.String(fmt.Sprintf("bulk message %d", number)))
		}
		if _, err := jetExec(ctx, pool, statement); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := jetExec(ctx, pool, jetpg.RawStatement("ANALYZE ligo_messages")); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		name string
		read func() error
	}{
		{"latest-message-page", func() error {
			page, err := store.ListMessages(ctx, owner.ID, conversation.ID, "", 30)
			if err == nil && len(page.Items) != 30 {
				t.Errorf("latest page size = %d, want 30", len(page.Items))
			}
			return err
		}},
		{"conversation-with-unread-count", func() error {
			item, err := store.GetConversation(ctx, owner.ID, conversation.ID)
			if err == nil && item.UnreadCount != 10000 {
				t.Errorf("unread count = %d, want 10000", item.UnreadCount)
			}
			return err
		}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			durations := make([]time.Duration, 40)
			for index := range durations {
				start := time.Now()
				if err := scenario.read(); err != nil {
					t.Fatal(err)
				}
				durations[index] = time.Since(start)
			}
			sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
			t.Logf("10,000 messages / 40 reads: p50=%s p95=%s max=%s",
				durations[19], durations[37], durations[39])
		})
	}
}
