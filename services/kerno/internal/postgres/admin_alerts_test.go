package postgres

// Verifies alert cursors and that notices reach only active administrators' Saved messages
import (
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
)

func TestAdminAlertCursorsAndNotices(t *testing.T) {
	ctx, pool := testDatabase(t)
	users := NewUsers(pool)
	store := NewAdmin(pool)
	roles := table.UserRoles
	accounts := map[string]string{}
	for _, name := range []string{"alertadmin", "alertretired", "alertmember"} {
		user, err := users.Upsert(ctx, name, name, name)
		if err != nil {
			t.Fatal(err)
		}
		accounts[name] = user.ID
		if name == "alertmember" {
			continue
		}
		if _, err := jetExec(ctx, pool, roles.INSERT(roles.UserID, roles.Role).VALUES(jetUUID(user.ID), jetpg.String("admin"))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := jetExec(ctx, pool, table.Users.UPDATE(table.Users.DisabledAt).SET(jetpg.RawTimestampz("now()")).
		WHERE(table.Users.ID.EQ(jetUUID(accounts["alertretired"])))); err != nil {
		t.Fatal(err)
	}

	if cursor, err := store.AlertCursor(ctx, "local"); err != nil || cursor != 0 {
		t.Fatalf("initial cursor = %d, %v", cursor, err)
	}
	for _, sequence := range []int64{5, 7} {
		if err := store.SetAlertCursor(ctx, "local", sequence); err != nil {
			t.Fatal(err)
		}
	}
	if cursor, err := store.AlertCursor(ctx, "local"); err != nil || cursor != 7 {
		t.Fatalf("cursor = %d, %v", cursor, err)
	}

	for _, text := range []string{"Critical on kaordo: Device 2 is missing.", "Resolved on kaordo: Device 2 is missing."} {
		if err := store.NotifyAdministrators(ctx, text); err != nil {
			t.Fatal(err)
		}
	}
	ligo := NewLigo(pool)
	for name, want := range map[string]int{"alertadmin": 2, "alertretired": 0, "alertmember": 0} {
		page, err := ligo.ListConversations(ctx, accounts[name], nil, 20)
		if err != nil {
			t.Fatal(err)
		}
		notices := 0
		for _, conversation := range page.Items {
			if conversation.Kind != "self" {
				continue
			}
			messages, err := ligo.ListMessages(ctx, accounts[name], conversation.ID, "", 20)
			if err != nil {
				t.Fatal(err)
			}
			for _, message := range messages.Items {
				if !message.SystemNotice {
					t.Fatalf("%s received a regular message %+v", name, message)
				}
				notices++
			}
			if conversation.UnreadCount != 2 || conversation.LastMessage == nil || conversation.LastMessage.Text != "Resolved on kaordo: Device 2 is missing." {
				t.Fatalf("%s Saved messages = %+v", name, conversation)
			}
		}
		if notices != want {
			t.Fatalf("%s received %d notices, want %d", name, notices, want)
		}
	}
}
