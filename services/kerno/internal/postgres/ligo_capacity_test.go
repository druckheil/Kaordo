package postgres

import (
	"context"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/jackc/pgx/v5/pgxpool"
)

// This measures the real paginated read path in a disposable database.
// Timings describe this machine, not a portable service-level guarantee.
func TestLigoReadCapacity(t *testing.T) {
	dsn := os.Getenv("KAORDO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set KAORDO_TEST_DATABASE_URL to an isolated migrated test database")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
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
		if _, err := pool.Exec(ctx, `DELETE FROM ligo_conversations WHERE id = $1::uuid`, conversation.ID); err != nil {
			t.Errorf("remove capacity conversation: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, owner.ID, peer.ID); err != nil {
			t.Errorf("remove capacity users: %v", err)
		}
	})
	if _, err := pool.Exec(ctx, `INSERT INTO ligo_messages (conversation_id, sender_id, client_id, body)
		SELECT $1::uuid, $2::uuid, uuidv7(), 'bulk message ' || number
		FROM generate_series(1, 10000) AS number`, conversation.ID, peer.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `ANALYZE ligo_messages`); err != nil {
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
