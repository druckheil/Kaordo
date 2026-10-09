package postgres

import (
	"errors"
	"fmt"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
)

func TestLigoConversationFlow(t *testing.T) {
	ctx, pool := testDatabase(t)
	users := NewUsers(pool)
	alice, err := users.Upsert(ctx, "ligo-alice", "ligoalice", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	bob, err := users.Upsert(ctx, "ligo-bob", "ligobob", "Bob")
	if err != nil {
		t.Fatal(err)
	}
	charlie, err := users.Upsert(ctx, "ligo-charlie", "ligocharlie", "Charlie")
	if err != nil {
		t.Fatal(err)
	}
	store := NewLigo(pool)
	results, err := store.SearchUsers(ctx, alice.ID, "ligobob")
	if err != nil || len(results) != 1 || results[0].ID != bob.ID {
		t.Fatalf("search = %+v, %v", results, err)
	}
	results, err = store.SearchUsers(ctx, alice.ID, "%_")
	if err != nil || len(results) != 0 {
		t.Fatalf("search treated wildcard characters as a pattern: %+v, %v", results, err)
	}
	duo, err := store.CreateConversation(ctx, alice.ID, ligo.NewConversation{Kind: "duo", ParticipantIDs: []string{bob.ID}})
	if err != nil || duo.Kind != "duo" || len(duo.Members) != 2 {
		t.Fatalf("duo = %+v, %v", duo, err)
	}
	reused, err := store.CreateConversation(ctx, bob.ID, ligo.NewConversation{Kind: "duo", ParticipantIDs: []string{alice.ID}})
	if err != nil || reused.ID != duo.ID {
		t.Fatalf("duo was duplicated: %+v, %v", reused, err)
	}
	if _, err := store.GetConversation(ctx, charlie.ID, duo.ID); !errors.Is(err, ligo.ErrNotFound) {
		t.Fatalf("outsider read a conversation: %v", err)
	}
	if _, err := store.ListMessages(ctx, charlie.ID, duo.ID, "", 20); !errors.Is(err, ligo.ErrNotFound) {
		t.Fatalf("outsider read messages: %v", err)
	}
	messageID := "01999111-2222-7333-8444-555555555500"
	message, err := store.Send(ctx, alice.ID, duo.ID, ligo.NewMessage{ClientID: messageID, Text: "Hello"}, nil)
	if err != nil || message.Text != "Hello" || message.Sender.ID != alice.ID {
		t.Fatalf("send = %+v, %v", message, err)
	}
	same, err := store.Send(ctx, alice.ID, duo.ID, ligo.NewMessage{ClientID: messageID, Text: "Hello"}, nil)
	if err != nil || same.ID != message.ID {
		t.Fatalf("idempotency = %+v, %v", same, err)
	}
	if _, err := store.Send(ctx, charlie.ID, duo.ID, ligo.NewMessage{
		ClientID: "01999111-2222-7333-8444-555555555501", Text: "intrusion",
	}, nil); !errors.Is(err, ligo.ErrNotFound) {
		t.Fatalf("outsider sent a message: %v", err)
	}
	beforeRead, err := store.GetConversation(ctx, bob.ID, duo.ID)
	if err != nil || beforeRead.UnreadCount != 1 {
		t.Fatalf("unread = %+v, %v", beforeRead, err)
	}
	if err := store.MarkRead(ctx, bob.ID, duo.ID, message.ID); err != nil {
		t.Fatal(err)
	}
	afterRead, err := store.GetConversation(ctx, bob.ID, duo.ID)
	if err != nil || afterRead.UnreadCount != 0 {
		t.Fatalf("read = %+v, %v", afterRead, err)
	}
	for index := range 4 {
		_, err := store.Send(ctx, bob.ID, duo.ID, ligo.NewMessage{
			ClientID: fmt.Sprintf("01999111-2222-7333-8444-%012d", index+510),
			Text:     fmt.Sprintf("Message %d", index),
		}, nil)
		if err != nil {
			t.Fatal(err)
		}
	}
	page, err := store.ListMessages(ctx, alice.ID, duo.ID, "", 2)
	if err != nil || len(page.Items) != 2 || page.NextCursor == nil {
		t.Fatalf("first page = %+v, %v", page, err)
	}
	older, err := store.ListMessages(ctx, alice.ID, duo.ID, *page.NextCursor, 2)
	if err != nil || len(older.Items) != 2 || older.Items[0].ID == page.Items[0].ID {
		t.Fatalf("older page = %+v, %v", older, err)
	}
	group, err := store.CreateConversation(ctx, alice.ID, ligo.NewConversation{
		Kind: "group", Title: "The team", ParticipantIDs: []string{bob.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	conversationPage, err := store.ListConversations(ctx, alice.ID, nil, 1)
	if err != nil || len(conversationPage.Items) != 1 || conversationPage.NextCursor == nil {
		t.Fatalf("conversation page = %+v, %v", conversationPage, err)
	}
	cursor, err := ligo.DecodeConversationCursor(*conversationPage.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	olderConversations, err := store.ListConversations(ctx, alice.ID, cursor, 1)
	if err != nil || len(olderConversations.Items) != 1 || olderConversations.Items[0].ID == conversationPage.Items[0].ID {
		t.Fatalf("older conversations = %+v, %v", olderConversations, err)
	}
	self, err := store.CreateConversation(ctx, alice.ID, ligo.NewConversation{Kind: "self"})
	if err != nil || self.Kind != "self" || len(self.Members) != 1 || self.Members[0].ID != alice.ID {
		t.Fatalf("saved messages = %+v, %v", self, err)
	}
	selfAgain, err := store.CreateConversation(ctx, alice.ID, ligo.NewConversation{Kind: "self"})
	if err != nil || selfAgain.ID != self.ID {
		t.Fatalf("saved messages duplicated: %+v, %v", selfAgain, err)
	}
	if _, err := store.GetConversation(ctx, bob.ID, self.ID); !errors.Is(err, ligo.ErrNotFound) {
		t.Fatalf("another user read saved messages: %v", err)
	}
	if _, err := store.Send(ctx, alice.ID, self.ID, ligo.NewMessage{
		ClientID: "01999111-2222-7333-8444-555555555540", Text: "Remember this",
	}, nil); err != nil {
		t.Fatalf("saved message send: %v", err)
	}
	if _, err := store.AddMembers(ctx, bob.ID, group.ID, []string{charlie.ID}); !errors.Is(err, ligo.ErrForbidden) {
		t.Fatalf("non-creator added members: %v", err)
	}
	beforeJoin, err := store.Send(ctx, alice.ID, group.ID, ligo.NewMessage{
		ClientID: "01999111-2222-7333-8444-555555555520", Text: "Before Charlie",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	expanded, err := store.AddMembers(ctx, alice.ID, group.ID, []string{charlie.ID})
	if err != nil || len(expanded.Members) != 3 {
		t.Fatalf("add member = %+v, %v", expanded, err)
	}
	charlieConversation, err := store.GetConversation(ctx, charlie.ID, group.ID)
	if err != nil || charlieConversation.LastMessage != nil {
		t.Fatalf("new member saw an earlier preview: %+v, %v", charlieConversation, err)
	}
	charliePage, err := store.ListMessages(ctx, charlie.ID, group.ID, "", 30)
	if err != nil || len(charliePage.Items) != 0 {
		t.Fatalf("new member saw earlier history: %+v, %v (prior=%s)", charliePage, err, beforeJoin.ID)
	}
	afterJoin, err := store.Send(ctx, alice.ID, group.ID, ligo.NewMessage{
		ClientID: "01999111-2222-7333-8444-555555555521", Text: "After Charlie",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	charliePage, err = store.ListMessages(ctx, charlie.ID, group.ID, "", 30)
	if err != nil || len(charliePage.Items) != 1 {
		t.Fatalf("new member messages = %+v, %v", charliePage, err)
	}
	if err := store.MarkDelivered(ctx, bob.ID, group.ID, afterJoin.ID); err != nil {
		t.Fatal(err)
	}
	afterJoin, err = store.message(ctx, alice.ID, afterJoin.ID)
	if err != nil || afterJoin.Status != "sent" {
		t.Fatalf("group delivered by one of two recipients = %+v, %v", afterJoin, err)
	}
	if err := store.MarkDelivered(ctx, charlie.ID, group.ID, afterJoin.ID); err != nil {
		t.Fatal(err)
	}
	afterJoin, err = store.message(ctx, alice.ID, afterJoin.ID)
	if err != nil || afterJoin.Status != "delivered" {
		t.Fatalf("group delivered by all recipients = %+v, %v", afterJoin, err)
	}
	if err := store.MarkRead(ctx, bob.ID, group.ID, afterJoin.ID); err != nil {
		t.Fatal(err)
	}
	afterJoin, err = store.message(ctx, alice.ID, afterJoin.ID)
	if err != nil || afterJoin.Status != "delivered" {
		t.Fatalf("group read by one of two recipients = %+v, %v", afterJoin, err)
	}
	if err := store.MarkRead(ctx, charlie.ID, group.ID, afterJoin.ID); err != nil {
		t.Fatal(err)
	}
	afterJoin, err = store.message(ctx, alice.ID, afterJoin.ID)
	if err != nil || afterJoin.Status != "read" {
		t.Fatalf("group read by all recipients = %+v, %v", afterJoin, err)
	}
	attachment := ligo.Media{ID: "01999111-2222-7333-8444-555555555591",
		Kind: "image", MimeType: "image/png", Width: 8, Height: 6, Size: 80}
	withMedia, err := store.Send(ctx, alice.ID, duo.ID, ligo.NewMessage{
		ClientID: "01999111-2222-7333-8444-555555555530", Text: "", AttachmentIDs: []string{attachment.ID},
	}, []ligo.Media{attachment})
	if err != nil || len(withMedia.Media) != 1 || withMedia.Media[0].ID != attachment.ID {
		t.Fatalf("media message = %+v, %v", withMedia, err)
	}
	if _, err := store.Send(ctx, bob.ID, duo.ID, ligo.NewMessage{
		ClientID: "01999111-2222-7333-8444-555555555531", AttachmentIDs: []string{attachment.ID},
	}, []ligo.Media{attachment}); !errors.Is(err, ligo.ErrMediaOwner) {
		t.Fatalf("another user reused media: %v", err)
	}
	referenced, err := NewFluo(pool).MediaReferenced(ctx, attachment.ID)
	if err != nil || !referenced {
		t.Fatalf("Nodo reference = %t, %v", referenced, err)
	}
	if _, err := NewFluo(pool).UpdateKeyring(ctx, alice.ID, fluo.KeyringUpdate{Create: 1, Publish: []fluo.PublishedKey{{Version: 1, Key: randomBase64(t, 32)}}}); err != nil {
		t.Fatal(err)
	}
	sharedPost := registerFluoAuthor(t, ctx, pool, alice.ID).newPost(t, "public", nil, nil, encryption.KeyRef{OwnerID: alice.ID, Version: 1})
	fluoPost, err := NewFluo(pool).Create(ctx, alice.ID, sharedPost, postText(sharedPost),
		[]fluo.Media{{ID: attachment.ID, Kind: "file", MimeType: "application/octet-stream", Size: attachment.Size}})
	if err != nil {
		t.Fatal(err)
	}
	if retired, err := NewFluo(pool).Delete(ctx, alice.ID, fluoPost.ID); err != nil || len(retired) != 0 {
		t.Fatalf("Ligo-owned bytes were scheduled for deletion: %v, %v", retired, err)
	}
	referenced, err = NewFluo(pool).MediaReferenced(ctx, attachment.ID)
	if err != nil || !referenced {
		t.Fatalf("Fluo deletion lost Ligo bytes: %t, %v", referenced, err)
	}
	file := ligo.Media{ID: "01999111-2222-7333-8444-555555555592", Kind: "file",
		MimeType: "application/octet-stream", Filename: "notes.pdf", Size: 128}
	fileMessage, err := store.Send(ctx, alice.ID, duo.ID, ligo.NewMessage{
		ClientID: "01999111-2222-7333-8444-555555555532", AttachmentIDs: []string{file.ID},
	}, []ligo.Media{file})
	if err != nil || len(fileMessage.Media) != 1 || fileMessage.Media[0].Filename != "notes.pdf" {
		t.Fatalf("file message = %+v, %v", fileMessage, err)
	}
	if _, err := store.SetReaction(ctx, charlie.ID, duo.ID, message.ID, "❤️", true); !errors.Is(err, ligo.ErrNotFound) {
		t.Fatalf("outsider reacted to message: %v", err)
	}
	if _, err := store.SetReaction(ctx, charlie.ID, group.ID, beforeJoin.ID, "❤️", true); !errors.Is(err, ligo.ErrNotFound) {
		t.Fatalf("new group member reacted to history before joining: %v", err)
	}
	liked, err := store.SetReaction(ctx, bob.ID, duo.ID, message.ID, "👍", true)
	if err != nil || len(liked.Reactions) != 1 || !liked.Reactions[0].Mine || liked.Reactions[0].Count != 1 {
		t.Fatalf("reaction = %+v, %v", liked.Reactions, err)
	}
	liked, err = store.SetReaction(ctx, bob.ID, duo.ID, message.ID, "👍", true)
	if err != nil || liked.Reactions[0].Count != 1 {
		t.Fatalf("reaction idempotency = %+v, %v", liked.Reactions, err)
	}
	liked, err = store.message(ctx, alice.ID, message.ID)
	if err != nil || liked.Reactions[0].Mine {
		t.Fatalf("reaction viewer isolation = %+v, %v", liked.Reactions, err)
	}
	liked, err = store.SetReaction(ctx, bob.ID, duo.ID, message.ID, "👍", false)
	if err != nil || len(liked.Reactions) != 0 {
		t.Fatalf("reaction removal = %+v, %v", liked.Reactions, err)
	}
	if _, err := store.Edit(ctx, bob.ID, duo.ID, message.ID, "Changed by Bob"); !errors.Is(err, ligo.ErrNotFound) {
		t.Fatalf("recipient edited another user's message: %v", err)
	}
	changed, err := store.Edit(ctx, alice.ID, duo.ID, message.ID, "Updated")
	if err != nil || changed.Text != "Updated" || changed.EditedAt == nil {
		t.Fatalf("message edit = %+v, %v", changed, err)
	}
	if _, err := store.Edit(ctx, alice.ID, duo.ID, message.ID, ""); !errors.Is(err, ligo.ErrInvalid) {
		t.Fatalf("text-only message erased without deleting: %v", err)
	}
	if _, err := store.DeleteMessage(ctx, bob.ID, duo.ID, message.ID); !errors.Is(err, ligo.ErrNotFound) {
		t.Fatalf("recipient deleted another user's message: %v", err)
	}
	retired, err := store.DeleteMessage(ctx, alice.ID, duo.ID, message.ID)
	if err != nil || len(retired) != 0 {
		t.Fatalf("delete text message = %v, %v", retired, err)
	}
	tombstone, err := store.message(ctx, bob.ID, message.ID)
	if err != nil || !tombstone.Deleted || tombstone.Text != "" || len(tombstone.Reactions) != 0 {
		t.Fatalf("deleted message leaked content: %+v, %v", tombstone, err)
	}
	if _, err := store.SetReaction(ctx, bob.ID, duo.ID, message.ID, "❤️", true); !errors.Is(err, ligo.ErrNotFound) {
		t.Fatalf("deleted message accepted a reaction: %v", err)
	}
	if _, err := store.Edit(ctx, alice.ID, duo.ID, message.ID, "Again"); !errors.Is(err, ligo.ErrNotFound) {
		t.Fatalf("deleted message was edited: %v", err)
	}

	receipt, err := store.Send(ctx, alice.ID, duo.ID, ligo.NewMessage{
		ClientID: "01999111-2222-7333-8444-555555555533", Text: "Receipt",
	}, nil)
	if err != nil || receipt.Status != "sent" {
		t.Fatalf("new message status = %+v, %v", receipt, err)
	}
	if err := store.MarkDelivered(ctx, bob.ID, duo.ID, receipt.ID); err != nil {
		t.Fatal(err)
	}
	receipt, err = store.message(ctx, alice.ID, receipt.ID)
	if err != nil || receipt.Status != "delivered" {
		t.Fatalf("delivered status = %+v, %v", receipt, err)
	}
	if err := store.MarkRead(ctx, bob.ID, duo.ID, receipt.ID); err != nil {
		t.Fatal(err)
	}
	receipt, err = store.message(ctx, alice.ID, receipt.ID)
	if err != nil || receipt.Status != "read" {
		t.Fatalf("read status = %+v, %v", receipt, err)
	}
	if err := store.MarkDelivered(ctx, charlie.ID, duo.ID, receipt.ID); !errors.Is(err, ligo.ErrNotFound) {
		t.Fatalf("outsider delivered a message: %v", err)
	}

	attachments := make([]ligo.Media, 8)
	attachmentIDs := make([]string, 8)
	for index := range attachments {
		id := fmt.Sprintf("01999111-2222-7333-8444-%012d", index+600)
		attachments[index] = ligo.Media{ID: id, Kind: "file", MimeType: "application/octet-stream",
			Filename: fmt.Sprintf("file-%d.bin", index), Size: 64, AltText: "A note"}
		attachmentIDs[index] = id
	}
	batch, err := store.Send(ctx, alice.ID, duo.ID, ligo.NewMessage{
		ClientID: "01999111-2222-7333-8444-555555555534", AttachmentIDs: attachmentIDs,
	}, attachments)
	if err != nil || len(batch.Media) != 8 || batch.Media[7].AltText != "A note" {
		t.Fatalf("eight attachments = %+v, %v", batch, err)
	}
	retired, err = store.DeleteMessage(ctx, alice.ID, duo.ID, batch.ID)
	if err != nil || len(retired) != 8 {
		t.Fatalf("eight attachment cleanup = %v, %v", retired, err)
	}
	batch, err = store.message(ctx, bob.ID, batch.ID)
	if err != nil || !batch.Deleted || len(batch.Media) != 0 {
		t.Fatalf("deleted media leaked: %+v, %v", batch, err)
	}

	memberIDs := make([]string, 0, 22)
	for index := range 22 {
		member, err := users.Upsert(ctx, fmt.Sprintf("ligo-cap-%d", index),
			fmt.Sprintf("ligocap%d", index), fmt.Sprintf("Member %d", index))
		if err != nil {
			t.Fatal(err)
		}
		memberIDs = append(memberIDs, member.ID)
	}
	fullGroup, err := store.AddMembers(ctx, alice.ID, group.ID, memberIDs)
	if err != nil || len(fullGroup.Members) != 25 {
		t.Fatalf("group capacity fixture = %+v, %v", fullGroup, err)
	}
	repeated, err := store.AddMembers(ctx, alice.ID, group.ID, []string{bob.ID})
	if err != nil || len(repeated.Members) != len(fullGroup.Members) ||
		!repeated.UpdatedAt.Equal(fullGroup.UpdatedAt) {
		t.Fatalf("re-adding an existing member at capacity = %+v, %v", repeated, err)
	}
	extra, err := users.Upsert(ctx, "ligo-cap-extra", "ligocapextra", "Extra member")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMembers(ctx, alice.ID, group.ID, []string{extra.ID}); !errors.Is(err, ligo.ErrInvalid) {
		t.Fatalf("new member passed group capacity: %v", err)
	}
}
