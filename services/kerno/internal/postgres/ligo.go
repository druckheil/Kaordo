package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Ligo struct{ pool *pgxpool.Pool }

func NewLigo(pool *pgxpool.Pool) *Ligo { return &Ligo{pool: pool} }

func (store *Ligo) SearchUsers(ctx context.Context, actorID, search string) ([]ligo.User, error) {
	literal := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search)
	usersTable := table.Users
	pattern := jetpg.String("%" + strings.ToLower(literal) + "%")
	exactFirst := jetpg.RawInt("CASE WHEN lower(users.username) = lower(#search) THEN 0 ELSE 1 END",
		jetpg.RawArgs{"#search": literal})
	query := jetpg.SELECT(jetpg.CAST(usersTable.ID).AS_TEXT(), usersTable.Username, usersTable.DisplayName).
		FROM(usersTable).WHERE(jetpg.AND(
		usersTable.ID.NOT_EQ(jetUUID(actorID)),
		jetpg.OR(jetpg.LOWER(usersTable.Username).LIKE(pattern), jetpg.LOWER(usersTable.DisplayName).LIKE(pattern)),
	)).ORDER_BY(exactFirst.ASC(), jetpg.LOWER(usersTable.Username).ASC()).LIMIT(20)
	rows, err := jetQuery(ctx, store.pool, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := make([]ligo.User, 0)
	for rows.Next() {
		var user ligo.User
		if err := rows.Scan(&user.ID, &user.Username, &user.DisplayName); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func conversationQuery(actorID string) (jetpg.SelectStatement, *table.LigoConversationsTable) {
	conversations := table.LigoConversations.AS("c")
	viewer := table.LigoMembers.AS("viewer")
	unread := table.LigoMessages.AS("unread")
	membersJSON := jetpg.RawString(`COALESCE((SELECT jsonb_agg(jsonb_build_object(
		'id', u.id::text, 'username', u.username, 'displayName', u.display_name
	) ORDER BY lower(u.username)) FROM ligo_members lm JOIN users u ON u.id = lm.user_id
	WHERE lm.conversation_id = c.id), '[]'::jsonb)`)
	lastMessage := jetpg.RawString(`(SELECT jsonb_build_object('id', m.id::text, 'text', m.body, 'senderId', m.sender_id::text,
		'deleted', m.deleted_at IS NOT NULL, 'createdAt', m.created_at)
		FROM ligo_messages m WHERE m.conversation_id = c.id AND m.created_at >= viewer.joined_at
		ORDER BY m.id DESC LIMIT 1)`)
	unreadCount := jetpg.IntExp(jetpg.SELECT(jetpg.COUNT(unread.ID)).FROM(unread).WHERE(jetpg.AND(
		unread.ConversationID.EQ(conversations.ID),
		jetpg.OR(unread.SenderID.NOT_EQ(jetUUID(actorID)), unread.SystemNotice.IS_TRUE()),
		unread.CreatedAt.GT_EQ(viewer.JoinedAt),
		jetpg.OR(viewer.LastReadMessageID.IS_NULL(), unread.ID.GT(viewer.LastReadMessageID)),
	)))
	query := jetpg.SELECT(
		jetpg.CAST(conversations.ID).AS_TEXT(), conversations.Kind, conversations.Title,
		jetpg.CAST(conversations.CreatedBy).AS_TEXT(), conversations.CreatedAt, conversations.UpdatedAt,
		membersJSON, lastMessage, unreadCount,
	).FROM(conversations.INNER_JOIN(viewer, jetpg.AND(
		viewer.ConversationID.EQ(conversations.ID), viewer.UserID.EQ(jetUUID(actorID)),
	)))
	return query, conversations
}

func scanConversation(row pgx.Row) (ligo.Conversation, error) {
	var item ligo.Conversation
	var members, preview []byte
	err := row.Scan(&item.ID, &item.Kind, &item.Title, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt,
		&members, &preview, &item.UnreadCount)
	if err != nil {
		return item, err
	}
	if err := json.Unmarshal(members, &item.Members); err != nil {
		return item, err
	}
	if len(preview) != 0 {
		var last ligo.MessagePreview
		if err := json.Unmarshal(preview, &last); err != nil {
			return item, err
		}
		item.LastMessage = &last
	}
	return item, nil
}

func (store *Ligo) GetConversation(ctx context.Context, actorID, id string) (ligo.Conversation, error) {
	query, conversations := conversationQuery(actorID)
	item, err := scanConversation(jetQueryRow(ctx, store.pool, query.WHERE(conversations.ID.EQ(jetUUID(id)))))
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ligo.ErrNotFound
	}
	return item, err
}

func (store *Ligo) ListConversations(ctx context.Context, actorID string, cursor *ligo.ConversationCursor, limit int) (ligo.ConversationPage, error) {
	query, conversations := conversationQuery(actorID)
	condition := conversations.Kind.NOT_EQ(jetpg.String("channel"))
	if cursor != nil {
		condition = jetpg.AND(condition, jetpg.OR(
			conversations.UpdatedAt.LT(jetpg.TimestampzT(cursor.UpdatedAt)),
			jetpg.AND(conversations.UpdatedAt.EQ(jetpg.TimestampzT(cursor.UpdatedAt)),
				conversations.ID.LT(jetUUID(cursor.ID))),
		))
	}
	rows, err := jetQuery(ctx, store.pool, query.WHERE(condition).
		ORDER_BY(conversations.UpdatedAt.DESC(), conversations.ID.DESC()).LIMIT(int64(limit+1)))
	if err != nil {
		return ligo.ConversationPage{}, err
	}
	defer rows.Close()
	page := ligo.ConversationPage{Items: make([]ligo.Conversation, 0)}
	for rows.Next() {
		item, err := scanConversation(rows)
		if err != nil {
			return ligo.ConversationPage{}, err
		}
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return ligo.ConversationPage{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		value := ligo.EncodeConversationCursor(page.Items[len(page.Items)-1])
		page.NextCursor = &value
	}
	return page, nil
}

func (store *Ligo) CreateConversation(ctx context.Context, actorID string, input ligo.NewConversation) (ligo.Conversation, error) {
	ids := append([]string{actorID}, input.ParticipantIDs...)
	sort.Strings(ids)
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return ligo.Conversation{}, err
	}
	defer tx.Rollback(ctx)
	var existing int
	users := table.Users
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(users.ID)).FROM(users).
		WHERE(users.ID.IN(jetUUIDList(ids)...))).Scan(&existing); err != nil {
		return ligo.Conversation{}, err
	}
	if existing != len(ids) {
		return ligo.Conversation{}, ligo.ErrNotFound
	}
	var id string
	conversations := table.LigoConversations
	if input.Kind == "duo" {
		statement := conversations.INSERT(conversations.Kind, conversations.CreatedBy, conversations.DuoLow, conversations.DuoHigh).
			VALUES(jetpg.String("duo"), jetUUID(actorID), jetUUID(ids[0]), jetUUID(ids[1])).
			ON_CONFLICT(conversations.DuoLow, conversations.DuoHigh).
			DO_UPDATE(jetpg.SET(conversations.DuoLow.SET(conversations.EXCLUDED.DuoLow))).
			RETURNING(jetpg.CAST(conversations.ID).AS_TEXT())
		err = jetQueryRow(ctx, tx, statement).Scan(&id)
	} else if input.Kind == "self" {
		statement := conversations.INSERT(conversations.Kind, conversations.CreatedBy).
			VALUES(jetpg.String("self"), jetUUID(actorID)).
			ON_CONFLICT(conversations.CreatedBy).WHERE(conversations.Kind.EQ(jetpg.String("self"))).
			DO_UPDATE(jetpg.SET(conversations.CreatedBy.SET(conversations.EXCLUDED.CreatedBy))).
			RETURNING(jetpg.CAST(conversations.ID).AS_TEXT())
		err = jetQueryRow(ctx, tx, statement).Scan(&id)
	} else {
		statement := conversations.INSERT(conversations.Kind, conversations.Title, conversations.CreatedBy).
			VALUES(jetpg.String("group"), jetpg.String(input.Title), jetUUID(actorID)).
			RETURNING(jetpg.CAST(conversations.ID).AS_TEXT())
		err = jetQueryRow(ctx, tx, statement).Scan(&id)
	}
	if err != nil {
		return ligo.Conversation{}, err
	}
	for _, userID := range ids {
		members := table.LigoMembers
		_, err = jetExec(ctx, tx, members.INSERT(members.ConversationID, members.UserID).
			VALUES(jetUUID(id), jetUUID(userID)).ON_CONFLICT().DO_NOTHING())
		if err != nil {
			return ligo.Conversation{}, err
		}
	}
	if err := jetNotify(ctx, tx, "ligo_activity", id); err != nil {
		return ligo.Conversation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ligo.Conversation{}, err
	}
	return store.GetConversation(ctx, actorID, id)
}

func (store *Ligo) AddMembers(ctx context.Context, actorID, conversationID string, memberIDs []string) (ligo.Conversation, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return ligo.Conversation{}, err
	}
	defer tx.Rollback(ctx)
	var creator string
	conversations := table.LigoConversations
	err = jetQueryRow(ctx, tx, conversations.SELECT(jetpg.CAST(conversations.CreatedBy).AS_TEXT()).
		WHERE(jetpg.AND(conversations.ID.EQ(jetUUID(conversationID)),
			conversations.Kind.EQ(jetpg.String("group")))).FOR(jetpg.UPDATE())).Scan(&creator)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.Conversation{}, ligo.ErrNotFound
	}
	if err != nil {
		return ligo.Conversation{}, err
	}
	if creator != actorID {
		return ligo.Conversation{}, ligo.ErrForbidden
	}
	var total, alreadyMembers int
	members := table.LigoMembers
	memberCount := jetpg.RawInt("count(*) FILTER (WHERE user_id = ANY(#member_ids::uuid[]))",
		jetpg.RawArgs{"#member_ids": memberIDs})
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(members.UserID), memberCount).FROM(members).
		WHERE(members.ConversationID.EQ(jetUUID(conversationID)))).Scan(&total, &alreadyMembers); err != nil {
		return ligo.Conversation{}, err
	}
	if total+len(memberIDs)-alreadyMembers > 25 {
		return ligo.Conversation{}, ligo.ErrInvalid
	}
	var found int
	users := table.Users
	if len(memberIDs) > 0 {
		if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(users.ID)).FROM(users).
			WHERE(users.ID.IN(jetUUIDList(memberIDs)...))).Scan(&found); err != nil {
			return ligo.Conversation{}, err
		}
	}
	if found != len(memberIDs) {
		return ligo.Conversation{}, ligo.ErrNotFound
	}
	if alreadyMembers == len(memberIDs) {
		if err := tx.Commit(ctx); err != nil {
			return ligo.Conversation{}, err
		}
		return store.GetConversation(ctx, actorID, conversationID)
	}
	for _, userID := range memberIDs {
		if _, err := jetExec(ctx, tx, members.INSERT(members.ConversationID, members.UserID).
			VALUES(jetUUID(conversationID), jetUUID(userID)).ON_CONFLICT().DO_NOTHING()); err != nil {
			return ligo.Conversation{}, err
		}
	}
	if _, err := jetExec(ctx, tx, conversations.UPDATE().SET(
		conversations.UpdatedAt.SET(jetpg.RawTimestampz("now()")),
	).WHERE(conversations.ID.EQ(jetUUID(conversationID)))); err != nil {
		return ligo.Conversation{}, err
	}
	if err := jetNotify(ctx, tx, "ligo_activity", conversationID); err != nil {
		return ligo.Conversation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ligo.Conversation{}, err
	}
	return store.GetConversation(ctx, actorID, conversationID)
}

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

func (store *Ligo) Send(ctx context.Context, actorID, conversationID string, input ligo.NewMessage, media []ligo.Media) (ligo.Message, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return ligo.Message{}, err
	}
	defer tx.Rollback(ctx)
	// Serialize membership changes and sends so the join timestamp determines
	// exactly which messages a newly invited member may read.
	var lockedConversation string
	conversations := table.LigoConversations
	err = jetQueryRow(ctx, tx, conversations.SELECT(jetpg.CAST(conversations.ID).AS_TEXT()).
		WHERE(conversations.ID.EQ(jetUUID(conversationID))).FOR(jetpg.UPDATE())).Scan(&lockedConversation)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.Message{}, ligo.ErrNotFound
	}
	if err != nil {
		return ligo.Message{}, err
	}
	var joined time.Time
	members := table.LigoMembers
	err = jetQueryRow(ctx, tx, members.SELECT(members.JoinedAt).
		WHERE(jetpg.AND(members.ConversationID.EQ(jetUUID(conversationID)), members.UserID.EQ(jetUUID(actorID)))).
		FOR(jetpg.SHARE())).Scan(&joined)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.Message{}, ligo.ErrNotFound
	}
	if err != nil {
		return ligo.Message{}, err
	}
	var existing string
	messages := table.LigoMessages
	err = jetQueryRow(ctx, tx, messages.SELECT(jetpg.CAST(messages.ID).AS_TEXT()).WHERE(jetpg.AND(
		messages.SenderID.EQ(jetUUID(actorID)), messages.ClientID.EQ(jetUUID(input.ClientID)),
		messages.ConversationID.EQ(jetUUID(conversationID)),
	))).Scan(&existing)
	if err == nil {
		if err := tx.Commit(ctx); err != nil {
			return ligo.Message{}, err
		}
		return store.message(ctx, actorID, existing)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ligo.Message{}, err
	}
	if err := jetAdvisoryLock(ctx, tx, jetpg.RawString("pg_advisory_xact_lock(hashtext(#actor))", jetpg.RawArgs{"#actor": actorID})); err != nil {
		return ligo.Message{}, err
	}
	var recent int
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(messages.ID)).FROM(messages).WHERE(jetpg.AND(
		messages.SenderID.EQ(jetUUID(actorID)), messages.CreatedAt.GT(jetpg.RawTimestampz("now() - interval '1 minute'")),
	))).Scan(&recent); err != nil {
		return ligo.Message{}, err
	}
	if recent >= 60 {
		return ligo.Message{}, ligo.ErrRateLimited
	}
	claims := append([]ligo.Media(nil), media...)
	sort.Slice(claims, func(i, j int) bool { return claims[i].ID < claims[j].ID })
	uploadClaims := table.NodoUploadClaims
	for _, item := range claims {
		result, err := jetExec(ctx, tx, uploadClaims.INSERT(uploadClaims.UploadID, uploadClaims.OwnerID).
			VALUES(jetUUID(item.ID), jetUUID(actorID)).
			ON_CONFLICT(uploadClaims.UploadID).DO_UPDATE(jetpg.SET(
			uploadClaims.OwnerID.SET(uploadClaims.EXCLUDED.OwnerID),
		).WHERE(jetpg.AND(uploadClaims.OwnerID.EQ(uploadClaims.EXCLUDED.OwnerID), uploadClaims.RetiredAt.IS_NULL()))))
		if err != nil {
			return ligo.Message{}, err
		}
		if result.RowsAffected() == 0 {
			return ligo.Message{}, ligo.ErrMediaOwner
		}
	}
	var id string
	err = jetQueryRow(ctx, tx, messages.INSERT(messages.ConversationID, messages.SenderID, messages.ClientID, messages.Body).
		VALUES(jetUUID(conversationID), jetUUID(actorID), jetUUID(input.ClientID), jetpg.String(input.Text)).
		ON_CONFLICT(messages.SenderID, messages.ClientID).DO_NOTHING().
		RETURNING(jetpg.CAST(messages.ID).AS_TEXT())).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		var existingConversation string
		err = jetQueryRow(ctx, tx, messages.SELECT(jetpg.CAST(messages.ID).AS_TEXT(),
			jetpg.CAST(messages.ConversationID).AS_TEXT()).WHERE(jetpg.AND(
			messages.SenderID.EQ(jetUUID(actorID)), messages.ClientID.EQ(jetUUID(input.ClientID)),
		))).Scan(&id, &existingConversation)
		if err != nil {
			return ligo.Message{}, err
		}
		if existingConversation != conversationID {
			return ligo.Message{}, ligo.ErrInvalid
		}
		if err := tx.Commit(ctx); err != nil {
			return ligo.Message{}, err
		}
		return store.message(ctx, actorID, id)
	}
	if err != nil {
		return ligo.Message{}, err
	}
	messageMedia := table.LigoMessageMedia
	for position, item := range media {
		_, err := jetExec(ctx, tx, messageMedia.INSERT(messageMedia.MessageID, messageMedia.UploadID, messageMedia.Position,
			messageMedia.Kind, messageMedia.MimeType, messageMedia.Filename, messageMedia.Width, messageMedia.Height,
			messageMedia.SizeBytes, messageMedia.AltText).VALUES(jetUUID(id), jetUUID(item.ID), jetpg.Int(int64(position)),
			jetpg.String(item.Kind), jetpg.String(item.MimeType), jetpg.String(item.Filename), jetpg.Int(int64(item.Width)),
			jetpg.Int(int64(item.Height)), jetpg.Int(int64(item.Size)), jetpg.String(item.AltText)))
		if err != nil {
			return ligo.Message{}, err
		}
	}
	if _, err := jetExec(ctx, tx, conversations.UPDATE().SET(
		conversations.UpdatedAt.SET(jetpg.RawTimestampz("now()")),
	).WHERE(conversations.ID.EQ(jetUUID(conversationID)))); err != nil {
		return ligo.Message{}, err
	}
	if err := jetNotify(ctx, tx, "ligo_activity", conversationID); err != nil {
		return ligo.Message{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ligo.Message{}, err
	}
	return store.message(ctx, actorID, id)
}

func (store *Ligo) Edit(ctx context.Context, actorID, conversationID, messageID, text string) (ligo.Message, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return ligo.Message{}, err
	}
	defer tx.Rollback(ctx)
	messages := table.LigoMessages.AS("m")
	members := table.LigoMembers.AS("member")
	var locked string
	err = jetQueryRow(ctx, tx, messages.SELECT(jetpg.CAST(messages.ID).AS_TEXT()).
		FROM(messages.INNER_JOIN(members, jetpg.AND(
			members.ConversationID.EQ(messages.ConversationID), members.UserID.EQ(jetUUID(actorID)),
		))).WHERE(jetpg.AND(messages.ID.EQ(jetUUID(messageID)),
		messages.ConversationID.EQ(jetUUID(conversationID)), messages.SenderID.EQ(jetUUID(actorID)),
		messages.DeletedAt.IS_NULL(), messages.SystemNotice.IS_FALSE(),
	)).FOR(jetpg.UPDATE().OF(messages))).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.Message{}, ligo.ErrNotFound
	}
	if err != nil {
		return ligo.Message{}, err
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
	if err := jetNotify(ctx, tx, "ligo_activity", conversationID); err != nil {
		return ligo.Message{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ligo.Message{}, err
	}
	return store.message(ctx, actorID, messageID)
}

func (store *Ligo) DeleteMessage(ctx context.Context, actorID, conversationID, messageID string) ([]string, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	messages := table.LigoMessages.AS("m")
	members := table.LigoMembers.AS("member")
	var deleted bool
	err = jetQueryRow(ctx, tx, messages.SELECT(jetpg.RawBool("m.deleted_at IS NOT NULL")).
		FROM(messages.INNER_JOIN(members, jetpg.AND(
			members.ConversationID.EQ(messages.ConversationID), members.UserID.EQ(jetUUID(actorID)),
		))).WHERE(jetpg.AND(messages.ID.EQ(jetUUID(messageID)),
		messages.ConversationID.EQ(jetUUID(conversationID)), messages.SenderID.EQ(jetUUID(actorID)),
		messages.SystemNotice.IS_FALSE(),
	)).FOR(jetpg.UPDATE().OF(messages))).Scan(&deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ligo.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if deleted {
		return []string{}, tx.Commit(ctx)
	}
	messageMedia := table.LigoMessageMedia
	rows, err := jetQuery(ctx, tx, messageMedia.SELECT(jetpg.CAST(messageMedia.UploadID).AS_TEXT()).
		WHERE(messageMedia.MessageID.EQ(jetUUID(messageID))).ORDER_BY(messageMedia.UploadID.ASC()))
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	uploadClaims := table.NodoUploadClaims
	for _, id := range ids {
		var locked string
		if err := jetQueryRow(ctx, tx, uploadClaims.SELECT(jetpg.CAST(uploadClaims.UploadID).AS_TEXT()).
			WHERE(uploadClaims.UploadID.EQ(jetUUID(id))).FOR(jetpg.UPDATE())).Scan(&locked); err != nil {
			return nil, err
		}
	}
	if _, err := jetExec(ctx, tx, messageMedia.DELETE().WHERE(messageMedia.MessageID.EQ(jetUUID(messageID)))); err != nil {
		return nil, err
	}
	messageReactions := table.LigoMessageReactions
	if _, err := jetExec(ctx, tx, messageReactions.DELETE().WHERE(messageReactions.MessageID.EQ(jetUUID(messageID)))); err != nil {
		return nil, err
	}
	if _, err := jetExec(ctx, tx, messages.UPDATE().SET(messages.Body.SET(jetpg.String("")),
		messages.DeletedAt.SET(jetpg.RawTimestampz("clock_timestamp()")),
	).WHERE(messages.ID.EQ(jetUUID(messageID)))); err != nil {
		return nil, err
	}
	retired := make([]string, 0, len(ids))
	for _, id := range ids {
		claim := table.NodoUploadClaims.AS("claim")
		postMedia := table.FluoPostMedia.AS("post_media")
		messageMedia := table.LigoMessageMedia.AS("message_media")
		unused := jetpg.AND(
			jetpg.NOT(jetpg.EXISTS(jetpg.SELECT(postMedia.UploadID).FROM(postMedia).
				WHERE(postMedia.UploadID.EQ(claim.UploadID)))),
			jetpg.NOT(jetpg.EXISTS(jetpg.SELECT(messageMedia.UploadID).FROM(messageMedia).
				WHERE(messageMedia.UploadID.EQ(claim.UploadID)))),
		)
		result, err := jetExec(ctx, tx, claim.UPDATE().SET(
			claim.RetiredAt.SET(jetpg.RawTimestampz("now()")),
		).WHERE(jetpg.AND(claim.UploadID.EQ(jetUUID(id)), claim.RetiredAt.IS_NULL(), unused)))
		if err != nil {
			return nil, err
		}
		if result.RowsAffected() > 0 {
			retired = append(retired, id)
		}
	}
	conversations := table.LigoConversations
	if _, err := jetExec(ctx, tx, conversations.UPDATE().SET(
		conversations.UpdatedAt.SET(jetpg.RawTimestampz("now()")),
	).WHERE(conversations.ID.EQ(jetUUID(conversationID)))); err != nil {
		return nil, err
	}
	if err := jetNotify(ctx, tx, "ligo_activity", conversationID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return retired, nil
}

func (store *Ligo) SetReaction(ctx context.Context, actorID, conversationID, messageID, emoji string, active bool) (ligo.Message, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return ligo.Message{}, err
	}
	defer tx.Rollback(ctx)
	messages := table.LigoMessages.AS("m")
	members := table.LigoMembers.AS("member")
	var locked string
	err = jetQueryRow(ctx, tx, messages.SELECT(jetpg.CAST(messages.ID).AS_TEXT()).
		FROM(messages.INNER_JOIN(members, jetpg.AND(
			members.ConversationID.EQ(messages.ConversationID), members.UserID.EQ(jetUUID(actorID)),
		))).WHERE(jetpg.AND(messages.ID.EQ(jetUUID(messageID)),
		messages.ConversationID.EQ(jetUUID(conversationID)), messages.CreatedAt.GT_EQ(members.JoinedAt),
		messages.DeletedAt.IS_NULL(), messages.SystemNotice.IS_FALSE(),
	)).FOR(jetpg.SHARE().OF(messages))).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.Message{}, ligo.ErrNotFound
	}
	if err != nil {
		return ligo.Message{}, err
	}
	var result pgconn.CommandTag
	reactions := table.LigoMessageReactions
	if active {
		result, err = jetExec(ctx, tx, reactions.INSERT(reactions.MessageID, reactions.UserID, reactions.Emoji).
			VALUES(jetUUID(messageID), jetUUID(actorID), jetpg.String(emoji)).ON_CONFLICT().DO_NOTHING())
	} else {
		result, err = jetExec(ctx, tx, reactions.DELETE().WHERE(jetpg.AND(
			reactions.MessageID.EQ(jetUUID(messageID)), reactions.UserID.EQ(jetUUID(actorID)),
			reactions.Emoji.EQ(jetpg.String(emoji)),
		)))
	}
	if err != nil {
		return ligo.Message{}, err
	}
	if result.RowsAffected() > 0 {
		if err := jetNotify(ctx, tx, "ligo_activity", conversationID); err != nil {
			return ligo.Message{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return ligo.Message{}, err
	}
	return store.message(ctx, actorID, messageID)
}

func (store *Ligo) MarkDelivered(ctx context.Context, actorID, conversationID, messageID string) error {
	return store.markReceipt(ctx, actorID, conversationID, messageID, false)
}

func (store *Ligo) MarkRead(ctx context.Context, actorID, conversationID, messageID string) error {
	return store.markReceipt(ctx, actorID, conversationID, messageID, true)
}

func (store *Ligo) markReceipt(ctx context.Context, actorID, conversationID, messageID string, read bool) error {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var result pgconn.CommandTag
	members := table.LigoMembers.AS("lm")
	messages := table.LigoMessages.AS("m")
	if read {
		result, err = jetExec(ctx, tx, members.UPDATE().SET(
			members.LastReadMessageID.SET(messages.ID),
			members.LastDeliveredMessageID.SET(jetpg.RawString("GREATEST(COALESCE(lm.last_delivered_message_id, m.id), m.id)")),
		).FROM(messages).WHERE(jetpg.AND(members.ConversationID.EQ(jetUUID(conversationID)),
			members.UserID.EQ(jetUUID(actorID)), messages.ID.EQ(jetUUID(messageID)),
			messages.ConversationID.EQ(members.ConversationID), messages.CreatedAt.GT_EQ(members.JoinedAt),
			jetpg.OR(members.LastReadMessageID.IS_NULL(), members.LastReadMessageID.LT(messages.ID)),
		)))
	} else {
		result, err = jetExec(ctx, tx, members.UPDATE().SET(
			members.LastDeliveredMessageID.SET(messages.ID),
		).FROM(messages).WHERE(jetpg.AND(members.ConversationID.EQ(jetUUID(conversationID)),
			members.UserID.EQ(jetUUID(actorID)), messages.ID.EQ(jetUUID(messageID)),
			messages.ConversationID.EQ(members.ConversationID), messages.CreatedAt.GT_EQ(members.JoinedAt),
			jetpg.OR(members.LastDeliveredMessageID.IS_NULL(), members.LastDeliveredMessageID.LT(messages.ID)),
		)))
	}
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		var accessible bool
		if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(members.UserID).
			FROM(members.INNER_JOIN(messages, messages.ConversationID.EQ(members.ConversationID))).
			WHERE(jetpg.AND(members.ConversationID.EQ(jetUUID(conversationID)), members.UserID.EQ(jetUUID(actorID)),
				messages.ID.EQ(jetUUID(messageID)), messages.CreatedAt.GT_EQ(members.JoinedAt)))))).Scan(&accessible); err != nil {
			return err
		}
		if !accessible {
			return ligo.ErrNotFound
		}
	} else if err := jetNotify(ctx, tx, "ligo_activity", conversationID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (store *Ligo) MemberIDs(ctx context.Context, conversationID string) ([]string, error) {
	members := table.LigoMembers
	rows, err := jetQuery(ctx, store.pool, members.SELECT(jetpg.CAST(members.UserID).AS_TEXT()).
		WHERE(members.ConversationID.EQ(jetUUID(conversationID))))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
