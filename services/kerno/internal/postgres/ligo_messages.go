package postgres

// Stores Ligo messages, media, and message history
import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func messageQuery(viewerID string) jetpg.SelectStatement {
	messages := table.LigoMessages.AS("m")
	users := table.Users.AS("u")
	media := jetpg.RawString(`COALESCE((SELECT jsonb_agg(jsonb_build_object('id', mm.upload_id::text,
		'kind', mm.kind, 'mimeType', mm.mime_type, 'filename', mm.filename, 'width', mm.width,
		'height', mm.height, 'size', mm.size_bytes, 'altText', mm.alt_text)
		ORDER BY mm.position) FROM ligo_message_media mm WHERE mm.message_id = m.id), '[]'::jsonb)`)
	reactions := jetpg.RawString(`COALESCE((SELECT jsonb_agg(jsonb_build_object('emoji', grouped.emoji,
		'count', grouped.total, 'mine', grouped.mine) ORDER BY grouped.emoji)
		FROM (SELECT emoji, count(*)::int AS total, bool_or(user_id = #viewer::uuid) AS mine
			FROM ligo_message_reactions WHERE message_id = m.id GROUP BY emoji) grouped), '[]'::jsonb)`,
		jetpg.RawArgs{"#viewer": viewerID})
	status := jetpg.RawString(`CASE
		WHEN NOT EXISTS (SELECT 1 FROM ligo_members recipient WHERE recipient.conversation_id = m.conversation_id
			AND recipient.user_id <> m.sender_id AND recipient.joined_at <= m.created_at) THEN 'sent'
		WHEN NOT EXISTS (SELECT 1 FROM ligo_members recipient WHERE recipient.conversation_id = m.conversation_id
			AND recipient.user_id <> m.sender_id AND recipient.joined_at <= m.created_at
			AND (recipient.last_read_message_id IS NULL OR recipient.last_read_message_id < m.id)) THEN 'read'
		WHEN NOT EXISTS (SELECT 1 FROM ligo_members recipient WHERE recipient.conversation_id = m.conversation_id
			AND recipient.user_id <> m.sender_id AND recipient.joined_at <= m.created_at
			AND (recipient.last_delivered_message_id IS NULL OR recipient.last_delivered_message_id < m.id)) THEN 'delivered'
		ELSE 'sent' END`)
	return jetpg.SELECT(
		jetpg.CAST(messages.ID).AS_TEXT(), jetpg.CAST(messages.ConversationID).AS_TEXT(),
		jetpg.CAST(messages.ClientID).AS_TEXT(), messages.Body, messages.CreatedAt,
		messages.EditedAt, jetpg.RawBool("m.deleted_at IS NOT NULL"), messages.SystemNotice,
		jetpg.CAST(users.ID).AS_TEXT(), users.Username, users.DisplayName, media, reactions, status,
	).FROM(messages.INNER_JOIN(users, users.ID.EQ(messages.SenderID)))
}

func scanMessage(row pgx.Row) (ligo.Message, error) {
	var item ligo.Message
	var media, reactions []byte
	err := row.Scan(&item.ID, &item.ConversationID, &item.ClientID, &item.Text, &item.CreatedAt,
		&item.EditedAt, &item.Deleted, &item.SystemNotice,
		&item.Sender.ID, &item.Sender.Username, &item.Sender.DisplayName, &media, &reactions, &item.Status)
	if err != nil {
		return item, err
	}
	if err := json.Unmarshal(media, &item.Media); err != nil {
		return item, err
	}
	if err := json.Unmarshal(reactions, &item.Reactions); err != nil {
		return item, err
	}
	return item, nil
}

func (store *Ligo) message(ctx context.Context, viewerID, id string) (ligo.Message, error) {
	messages := table.LigoMessages.AS("m")
	return scanMessage(jetQueryRow(ctx, store.pool, messageQuery(viewerID).WHERE(messages.ID.EQ(jetUUID(id)))))
}

func (store *Ligo) ListMessages(ctx context.Context, actorID, conversationID, before string, limit int) (ligo.Page, error) {
	var joined time.Time
	members := table.LigoMembers
	err := jetQueryRow(ctx, store.pool, members.SELECT(members.JoinedAt).
		WHERE(jetpg.AND(members.ConversationID.EQ(jetUUID(conversationID)), members.UserID.EQ(jetUUID(actorID))))).Scan(&joined)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.Page{}, ligo.ErrNotFound
	}
	if err != nil {
		return ligo.Page{}, err
	}
	messages := table.LigoMessages.AS("m")
	condition := jetpg.AND(messages.ConversationID.EQ(jetUUID(conversationID)), messages.CreatedAt.GT_EQ(jetpg.TimestampzT(joined)))
	if before != "" {
		condition = jetpg.AND(condition, messages.ID.LT(jetUUID(before)))
	}
	rows, err := jetQuery(ctx, store.pool, messageQuery(actorID).WHERE(condition).
		ORDER_BY(messages.ID.DESC()).LIMIT(int64(limit+1)))
	if err != nil {
		return ligo.Page{}, err
	}
	defer rows.Close()
	page := ligo.Page{Items: make([]ligo.Message, 0)}
	for rows.Next() {
		item, err := scanMessage(rows)
		if err != nil {
			return ligo.Page{}, err
		}
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return ligo.Page{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		cursor := page.Items[len(page.Items)-1].ID
		page.NextCursor = &cursor
	}
	return page, nil
}

func (store *Ligo) Edit(ctx context.Context, actorID, conversationID, messageID, text string) (ligo.Message, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return ligo.Message{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockSendMembership(ctx, tx, actorID, conversationID); err != nil {
		return ligo.Message{}, err
	}
	messages := table.LigoMessages.AS("m")
	members := table.LigoMembers.AS("member")
	var locked, clientID string
	err = jetQueryRow(ctx, tx, messages.SELECT(jetpg.CAST(messages.ID).AS_TEXT(), jetpg.CAST(messages.ClientID).AS_TEXT()).
		FROM(messages.INNER_JOIN(members, jetpg.AND(
			members.ConversationID.EQ(messages.ConversationID), members.UserID.EQ(jetUUID(actorID)),
		))).WHERE(jetpg.AND(messages.ID.EQ(jetUUID(messageID)),
		messages.ConversationID.EQ(jetUUID(conversationID)), messages.SenderID.EQ(jetUUID(actorID)),
		messages.DeletedAt.IS_NULL(), messages.SystemNotice.IS_FALSE(),
	)).FOR(jetpg.UPDATE().OF(messages))).Scan(&locked, &clientID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.Message{}, ligo.ErrNotFound
	}
	if err != nil {
		return ligo.Message{}, err
	}
	if envelope, parseErr := encryption.ParseText(text); parseErr == nil {
		if envelope.Context != "ligo:"+conversationID+":"+clientID {
			return ligo.Message{}, encryption.ErrInvalid
		}
		audience, err := encryptionAudience(ctx, tx, actorID, "ligo-history", messageID, false)
		if err != nil {
			return ligo.Message{}, err
		}
		if err := verifyContentForAudience(ctx, tx, actorID, envelope, audience, "ligo:"+conversationID+":"); err != nil {
			return ligo.Message{}, err
		}
	}
	if text == "" {
		var hasMedia bool
		messageMedia := table.LigoMessageMedia
		if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(messageMedia.MessageID).
			FROM(messageMedia).WHERE(messageMedia.MessageID.EQ(jetUUID(messageID)))))).Scan(&hasMedia); err != nil {
			return ligo.Message{}, err
		}
		if !hasMedia {
			return ligo.Message{}, ligo.ErrInvalid
		}
	}
	if _, err := jetExec(ctx, tx, messages.UPDATE().SET(messages.Body.SET(jetpg.String(text)),
		messages.EditedAt.SET(jetpg.RawTimestampz("clock_timestamp()")),
	).WHERE(messages.ID.EQ(jetUUID(messageID)))); err != nil {
		return ligo.Message{}, err
	}
	conversations := table.LigoConversations
	if _, err := jetExec(ctx, tx, conversations.UPDATE().SET(
		conversations.UpdatedAt.SET(jetpg.RawTimestampz("now()")),
	).WHERE(conversations.ID.EQ(jetUUID(conversationID)))); err != nil {
		return ligo.Message{}, err
	}
	if err := notifyLigoActivity(ctx, tx, conversationID); err != nil {
		return ligo.Message{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ligo.Message{}, err
	}
	return store.message(ctx, actorID, messageID)
}
