package postgres

// Verifies Rondo membership, channel access, and message visibility against PostgreSQL
import (
	"errors"
	"os"
	"slices"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondo"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRondoServerAndChannelFlow(t *testing.T) {
	dsn := os.Getenv("KAORDO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set KAORDO_TEST_DATABASE_URL to an isolated migrated test database")
	}
	ctx := t.Context()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	users := NewUsers(pool)
	owner, err := users.Upsert(ctx, "rondo-owner", "rondoowner", "Owner")
	if err != nil {
		t.Fatal(err)
	}
	member, err := users.Upsert(ctx, "rondo-member", "rondomember", "Member")
	if err != nil {
		t.Fatal(err)
	}
	store, messages := NewRondo(pool), NewLigo(pool)
	private, err := store.Create(ctx, owner.ID, rondo.NewServer{Name: "Private team", Access: "private"})
	if err != nil || len(private.Channels) != 1 || len(private.Members) != 1 {
		t.Fatalf("private server = %+v, %v", private, err)
	}
	channel := private.Channels[0]
	if _, err := store.Join(ctx, member.ID, private.Server.ID); !errors.Is(err, rondo.ErrForbidden) {
		t.Fatalf("outsider joined private server: %v", err)
	}
	if _, err := store.Get(ctx, member.ID, private.Server.ID); !errors.Is(err, rondo.ErrNotFound) {
		t.Fatalf("outsider read private server: %v", err)
	}
	if _, err := store.VoiceChannel(ctx, member.ID, channel.ID); !errors.Is(err, rondo.ErrNotFound) {
		t.Fatalf("outsider accessed voice channel: %v", err)
	}
	send := func(clientID, text string) ligo.Message {
		t.Helper()
		message, err := messages.Send(ctx, owner.ID, channel.ConversationID, ligo.NewMessage{ClientID: clientID, Text: text}, nil)
		if err != nil {
			t.Fatal(err)
		}
		return message
	}
	send("01999111-2222-7333-8444-555555555601", "Before membership")
	invited, err := store.Invite(ctx, owner.ID, private.Server.ID, member.ID)
	if err != nil || len(invited.Members) != 2 {
		t.Fatalf("invite = %+v, %v", invited, err)
	}
	if _, err := store.Invite(ctx, member.ID, private.Server.ID, owner.ID); !errors.Is(err, rondo.ErrForbidden) {
		t.Fatalf("non-owner invited a member: %v", err)
	}
	again, err := store.Invite(ctx, owner.ID, private.Server.ID, member.ID)
	if err != nil || len(again.Members) != 2 {
		t.Fatalf("idempotent invite = %+v, %v", again, err)
	}
	if page, err := messages.ListMessages(ctx, member.ID, channel.ConversationID, "", 20); err != nil || len(page.Items) != 0 {
		t.Fatalf("new member saw old messages: %+v, %v", page, err)
	}
	message := send("01999111-2222-7333-8444-555555555602", "After membership")
	if page, err := messages.ListMessages(ctx, member.ID, channel.ConversationID, "", 20); err != nil || len(page.Items) != 1 || page.Items[0].ID != message.ID {
		t.Fatalf("member message visibility = %+v, %v", page, err)
	}
	if _, err := store.CreateChannel(ctx, member.ID, private.Server.ID, "unauthorized"); !errors.Is(err, rondo.ErrForbidden) {
		t.Fatalf("non-owner created channel: %v", err)
	}
	added, err := store.CreateChannel(ctx, owner.ID, private.Server.ID, "second")
	if err != nil || added.Position != 1 {
		t.Fatalf("new channel = %+v, %v", added, err)
	}
	if _, err := store.CreateChannel(ctx, owner.ID, private.Server.ID, "second"); !errors.Is(err, rondo.ErrConflict) {
		t.Fatalf("duplicate channel = %v", err)
	}
	if _, err := messages.GetConversation(ctx, member.ID, added.ConversationID); err != nil {
		t.Fatalf("new channel did not inherit members: %v", err)
	}
	if _, err := store.Leave(ctx, owner.ID, private.Server.ID); !errors.Is(err, rondo.ErrInvalid) {
		t.Fatalf("owner left their server: %v", err)
	}
	removed, err := store.Leave(ctx, member.ID, private.Server.ID)
	if err != nil || len(removed) != 2 || !slices.Contains(removed, channel.ID) || !slices.Contains(removed, added.ID) {
		t.Fatalf("removed channels = %v, %v", removed, err)
	}
	if _, err := messages.GetConversation(ctx, member.ID, channel.ConversationID); !errors.Is(err, ligo.ErrNotFound) {
		t.Fatalf("former member accessed channel: %v", err)
	}
	if _, err := store.VoiceChannel(ctx, member.ID, channel.ID); !errors.Is(err, rondo.ErrNotFound) {
		t.Fatalf("former member accessed voice: %v", err)
	}
	if _, err := store.Invite(ctx, owner.ID, private.Server.ID, member.ID); err != nil {
		t.Fatal(err)
	}
	if page, err := messages.ListMessages(ctx, member.ID, channel.ConversationID, "", 20); err != nil || len(page.Items) != 0 {
		t.Fatalf("rejoined member saw old history: %+v, %v", page, err)
	}
	public, err := store.Create(ctx, owner.ID, rondo.NewServer{Name: "Discoverable team", Access: "public"})
	if err != nil {
		t.Fatal(err)
	}
	discovered, err := store.Discover(ctx, member.ID, "Discoverable")
	if err != nil || len(discovered) != 1 || discovered[0].ID != public.Server.ID {
		t.Fatalf("discovery = %+v, %v", discovered, err)
	}
	joined, err := store.Join(ctx, member.ID, public.Server.ID)
	if err != nil || len(joined.Members) != 2 {
		t.Fatalf("public join = %+v, %v", joined, err)
	}
	joined, err = store.Join(ctx, member.ID, public.Server.ID)
	if err != nil || len(joined.Members) != 2 {
		t.Fatalf("idempotent public join = %+v, %v", joined, err)
	}
	if discovered, err := store.Discover(ctx, member.ID, "Discoverable"); err != nil || len(discovered) != 0 {
		t.Fatalf("joined server remained in discovery: %+v, %v", discovered, err)
	}
	if got, err := store.VoiceChannel(ctx, member.ID, public.Channels[0].ID); err != nil || got.ID != public.Channels[0].ID {
		t.Fatalf("voice membership = %+v, %v", got, err)
	}
	if found, err := store.List(ctx, member.ID, "%_"); err != nil || len(found) != 0 {
		t.Fatalf("wildcard search = %+v, %v", found, err)
	}
}
