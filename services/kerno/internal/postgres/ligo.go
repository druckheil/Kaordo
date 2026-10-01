package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Ligo struct{ pool *pgxpool.Pool }

func NewLigo(pool *pgxpool.Pool) *Ligo { return &Ligo{pool: pool} }

func (store *Ligo) SearchUsers(ctx context.Context, actorID, search string) ([]ligo.User, error) {
	literal := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search)
	rows, err := store.pool.Query(ctx, `SELECT id::text, username, display_name FROM users
		WHERE id <> $1::uuid AND (
			lower(username) LIKE '%' || lower($2) || '%' ESCAPE '\' OR
			lower(display_name) LIKE '%' || lower($2) || '%' ESCAPE '\')
		ORDER BY CASE WHEN lower(username) = lower($2) THEN 0 ELSE 1 END, lower(username)
		LIMIT 20`, actorID, literal)
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

const conversationSelect = `
	SELECT c.id::text, c.kind, c.title, c.created_by::text, c.created_at, c.updated_at,
		COALESCE((SELECT jsonb_agg(jsonb_build_object(
			'id', u.id::text, 'username', u.username, 'displayName', u.display_name
		) ORDER BY lower(u.username)) FROM ligo_members lm JOIN users u ON u.id = lm.user_id
		WHERE lm.conversation_id = c.id), '[]'::jsonb),
		(SELECT jsonb_build_object('id', m.id::text, 'text', m.body, 'senderId', m.sender_id::text,
			'deleted', m.deleted_at IS NOT NULL,
			'createdAt', m.created_at)
		 FROM ligo_messages m WHERE m.conversation_id = c.id
		 AND m.created_at >= viewer.joined_at ORDER BY m.id DESC LIMIT 1),
		(SELECT count(*)::int FROM ligo_messages m
		 WHERE m.conversation_id = c.id AND m.sender_id <> $1::uuid
		 AND m.created_at >= viewer.joined_at
		 AND (viewer.last_read_message_id IS NULL OR m.id > viewer.last_read_message_id))
	FROM ligo_conversations c
	JOIN ligo_members viewer ON viewer.conversation_id = c.id AND viewer.user_id = $1::uuid
`

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
	item, err := scanConversation(store.pool.QueryRow(ctx, conversationSelect+` WHERE c.id = $2::uuid`, actorID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ligo.ErrNotFound
	}
	return item, err
}

func (store *Ligo) ListConversations(ctx context.Context, actorID string, cursor *ligo.ConversationCursor, limit int) (ligo.ConversationPage, error) {
	var updatedAt any
	var id any
	if cursor != nil {
		updatedAt, id = cursor.UpdatedAt, cursor.ID
	}
	rows, err := store.pool.Query(ctx, conversationSelect+` WHERE ($2::timestamptz IS NULL OR
		(c.updated_at, c.id) < ($2::timestamptz, $3::uuid))
		ORDER BY c.updated_at DESC, c.id DESC LIMIT $4`, actorID, updatedAt, id, limit+1)
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
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM users WHERE id = ANY($1::uuid[])`, ids).Scan(&existing); err != nil {
		return ligo.Conversation{}, err
	}
	if existing != len(ids) {
		return ligo.Conversation{}, ligo.ErrNotFound
	}
	var id string
	if input.Kind == "duo" {
		err = tx.QueryRow(ctx, `INSERT INTO ligo_conversations (kind, created_by, duo_low, duo_high)
			VALUES ('duo', $1::uuid, $2::uuid, $3::uuid)
			ON CONFLICT (duo_low, duo_high) DO UPDATE SET duo_low = EXCLUDED.duo_low
			RETURNING id::text`, actorID, ids[0], ids[1]).Scan(&id)
	} else if input.Kind == "self" {
		err = tx.QueryRow(ctx, `INSERT INTO ligo_conversations (kind, created_by)
			VALUES ('self', $1::uuid)
			ON CONFLICT (created_by) WHERE kind = 'self' DO UPDATE SET created_by = EXCLUDED.created_by
			RETURNING id::text`, actorID).Scan(&id)
	} else {
		err = tx.QueryRow(ctx, `INSERT INTO ligo_conversations (kind, title, created_by)
			VALUES ('group', $1, $2::uuid) RETURNING id::text`, input.Title, actorID).Scan(&id)
	}
	if err != nil {
		return ligo.Conversation{}, err
	}
	for _, userID := range ids {
		_, err = tx.Exec(ctx, `INSERT INTO ligo_members (conversation_id, user_id)
			VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, id, userID)
		if err != nil {
			return ligo.Conversation{}, err
		}
	}
	if _, err := tx.Exec(ctx, `SELECT pg_notify('ligo_activity', $1)`, id); err != nil {
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
	err = tx.QueryRow(ctx, `SELECT created_by::text FROM ligo_conversations
		WHERE id = $1::uuid AND kind = 'group' FOR UPDATE`, conversationID).Scan(&creator)
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
	if err := tx.QueryRow(ctx, `SELECT count(*)::int,
		count(*) FILTER (WHERE user_id = ANY($2::uuid[]))::int
		FROM ligo_members WHERE conversation_id = $1::uuid`, conversationID, memberIDs).Scan(&total, &alreadyMembers); err != nil {
		return ligo.Conversation{}, err
	}
	if total+len(memberIDs)-alreadyMembers > 25 {
		return ligo.Conversation{}, ligo.ErrInvalid
	}
	var found int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM users WHERE id = ANY($1::uuid[])`, memberIDs).Scan(&found); err != nil {
		return ligo.Conversation{}, err
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
		if _, err := tx.Exec(ctx, `INSERT INTO ligo_members (conversation_id, user_id)
			VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, conversationID, userID); err != nil {
			return ligo.Conversation{}, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE ligo_conversations SET updated_at = now() WHERE id = $1::uuid`, conversationID); err != nil {
		return ligo.Conversation{}, err
	}
	if _, err := tx.Exec(ctx, `SELECT pg_notify('ligo_activity', $1)`, conversationID); err != nil {
		return ligo.Conversation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ligo.Conversation{}, err
	}
	return store.GetConversation(ctx, actorID, conversationID)
}

const messageSelect = `
	SELECT m.id::text, m.conversation_id::text, m.client_id::text, m.body, m.created_at,
		m.edited_at, m.deleted_at IS NOT NULL,
		u.id::text, u.username, u.display_name,
		COALESCE((SELECT jsonb_agg(jsonb_build_object('id', media.upload_id::text,
			'kind', media.kind, 'mimeType', media.mime_type, 'filename', media.filename, 'width', media.width,
			'height', media.height, 'size', media.size_bytes, 'altText', media.alt_text)
			ORDER BY media.position) FROM ligo_message_media media WHERE media.message_id = m.id), '[]'::jsonb),
		COALESCE((SELECT jsonb_agg(jsonb_build_object('emoji', reactions.emoji,
			'count', reactions.total, 'mine', reactions.mine) ORDER BY reactions.emoji)
			FROM (SELECT emoji, count(*)::int AS total, bool_or(user_id = $1::uuid) AS mine
				FROM ligo_message_reactions WHERE message_id = m.id GROUP BY emoji) reactions), '[]'::jsonb),
		CASE
			WHEN NOT EXISTS (SELECT 1 FROM ligo_members recipient WHERE recipient.conversation_id = m.conversation_id
				AND recipient.user_id <> m.sender_id AND recipient.joined_at <= m.created_at) THEN 'sent'
			WHEN NOT EXISTS (SELECT 1 FROM ligo_members recipient WHERE recipient.conversation_id = m.conversation_id
				AND recipient.user_id <> m.sender_id AND recipient.joined_at <= m.created_at
				AND (recipient.last_read_message_id IS NULL OR recipient.last_read_message_id < m.id)) THEN 'read'
			WHEN NOT EXISTS (SELECT 1 FROM ligo_members recipient WHERE recipient.conversation_id = m.conversation_id
				AND recipient.user_id <> m.sender_id AND recipient.joined_at <= m.created_at
				AND (recipient.last_delivered_message_id IS NULL OR recipient.last_delivered_message_id < m.id)) THEN 'delivered'
			ELSE 'sent'
		END
	FROM ligo_messages m JOIN users u ON u.id = m.sender_id
`

func scanMessage(row pgx.Row) (ligo.Message, error) {
	var item ligo.Message
	var media, reactions []byte
	err := row.Scan(&item.ID, &item.ConversationID, &item.ClientID, &item.Text, &item.CreatedAt,
		&item.EditedAt, &item.Deleted,
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
	return scanMessage(store.pool.QueryRow(ctx, messageSelect+` WHERE m.id = $2::uuid`, viewerID, id))
}

func (store *Ligo) ListMessages(ctx context.Context, actorID, conversationID, before string, limit int) (ligo.Page, error) {
	var joined time.Time
	err := store.pool.QueryRow(ctx, `SELECT joined_at FROM ligo_members
		WHERE conversation_id = $1::uuid AND user_id = $2::uuid`, conversationID, actorID).Scan(&joined)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.Page{}, ligo.ErrNotFound
	}
	if err != nil {
		return ligo.Page{}, err
	}
	rows, err := store.pool.Query(ctx, messageSelect+` WHERE m.conversation_id = $2::uuid
		AND m.created_at >= $3 AND ($4::uuid IS NULL OR m.id < $4::uuid)
		ORDER BY m.id DESC LIMIT $5`, actorID, conversationID, joined, nullableID(before), limit+1)
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

func nullableID(id string) any {
	if id == "" {
		return nil
	}
	return id
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
	err = tx.QueryRow(ctx, `SELECT id::text FROM ligo_conversations WHERE id = $1::uuid FOR UPDATE`, conversationID).Scan(&lockedConversation)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.Message{}, ligo.ErrNotFound
	}
	if err != nil {
		return ligo.Message{}, err
	}
	var joined time.Time
	err = tx.QueryRow(ctx, `SELECT joined_at FROM ligo_members WHERE conversation_id = $1::uuid
		AND user_id = $2::uuid FOR SHARE`, conversationID, actorID).Scan(&joined)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.Message{}, ligo.ErrNotFound
	}
	if err != nil {
		return ligo.Message{}, err
	}
	var existing string
	err = tx.QueryRow(ctx, `SELECT id::text FROM ligo_messages WHERE sender_id = $1::uuid AND client_id = $2::uuid
		AND conversation_id = $3::uuid`, actorID, input.ClientID, conversationID).Scan(&existing)
	if err == nil {
		if err := tx.Commit(ctx); err != nil {
			return ligo.Message{}, err
		}
		return store.message(ctx, actorID, existing)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ligo.Message{}, err
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, actorID); err != nil {
		return ligo.Message{}, err
	}
	var recent int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM ligo_messages
		WHERE sender_id = $1::uuid AND created_at > now() - interval '1 minute'`, actorID).Scan(&recent); err != nil {
		return ligo.Message{}, err
	}
	if recent >= 60 {
		return ligo.Message{}, ligo.ErrRateLimited
	}
	claims := append([]ligo.Media(nil), media...)
	sort.Slice(claims, func(i, j int) bool { return claims[i].ID < claims[j].ID })
	for _, item := range claims {
		result, err := tx.Exec(ctx, `INSERT INTO nodo_upload_claims (upload_id, owner_id)
			VALUES ($1::uuid, $2::uuid) ON CONFLICT (upload_id) DO UPDATE
			SET owner_id = EXCLUDED.owner_id WHERE nodo_upload_claims.owner_id = EXCLUDED.owner_id
			AND nodo_upload_claims.retired_at IS NULL`, item.ID, actorID)
		if err != nil {
			return ligo.Message{}, err
		}
		if result.RowsAffected() == 0 {
			return ligo.Message{}, ligo.ErrMediaOwner
		}
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO ligo_messages (conversation_id, sender_id, client_id, body)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
		ON CONFLICT (sender_id, client_id) DO NOTHING RETURNING id::text`,
		conversationID, actorID, input.ClientID, input.Text).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		var existingConversation string
		err = tx.QueryRow(ctx, `SELECT id::text, conversation_id::text FROM ligo_messages
			WHERE sender_id = $1::uuid AND client_id = $2::uuid`, actorID, input.ClientID).Scan(&id, &existingConversation)
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
	for position, item := range media {
		_, err := tx.Exec(ctx, `INSERT INTO ligo_message_media
			(message_id, upload_id, position, kind, mime_type, filename, width, height, size_bytes, alt_text)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)`,
			id, item.ID, position, item.Kind, item.MimeType, item.Filename, item.Width, item.Height, item.Size, item.AltText)
		if err != nil {
			return ligo.Message{}, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE ligo_conversations SET updated_at = now() WHERE id = $1::uuid`, conversationID); err != nil {
		return ligo.Message{}, err
	}
	if _, err := tx.Exec(ctx, `SELECT pg_notify('ligo_activity', $1)`, conversationID); err != nil {
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
	var locked string
	err = tx.QueryRow(ctx, `SELECT m.id::text FROM ligo_messages m
		JOIN ligo_members member ON member.conversation_id = m.conversation_id AND member.user_id = $1::uuid
		WHERE m.id = $2::uuid AND m.conversation_id = $3::uuid
		AND m.sender_id = $1::uuid AND m.deleted_at IS NULL FOR UPDATE OF m`,
		actorID, messageID, conversationID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.Message{}, ligo.ErrNotFound
	}
	if err != nil {
		return ligo.Message{}, err
	}
	if text == "" {
		var hasMedia bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ligo_message_media WHERE message_id = $1::uuid)`,
			messageID).Scan(&hasMedia); err != nil {
			return ligo.Message{}, err
		}
		if !hasMedia {
			return ligo.Message{}, ligo.ErrInvalid
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE ligo_messages SET body = $2, edited_at = clock_timestamp()
		WHERE id = $1::uuid`, messageID, text); err != nil {
		return ligo.Message{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE ligo_conversations SET updated_at = now() WHERE id = $1::uuid`, conversationID); err != nil {
		return ligo.Message{}, err
	}
	if _, err := tx.Exec(ctx, `SELECT pg_notify('ligo_activity', $1)`, conversationID); err != nil {
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
	var deleted bool
	err = tx.QueryRow(ctx, `SELECT m.deleted_at IS NOT NULL FROM ligo_messages m
		JOIN ligo_members member ON member.conversation_id = m.conversation_id AND member.user_id = $1::uuid
		WHERE m.id = $2::uuid AND m.conversation_id = $3::uuid
		AND m.sender_id = $1::uuid FOR UPDATE OF m`, actorID, messageID, conversationID).Scan(&deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ligo.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if deleted {
		return []string{}, tx.Commit(ctx)
	}
	rows, err := tx.Query(ctx, `SELECT upload_id::text FROM ligo_message_media
		WHERE message_id = $1::uuid ORDER BY upload_id`, messageID)
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
	for _, id := range ids {
		var locked string
		if err := tx.QueryRow(ctx, `SELECT upload_id::text FROM nodo_upload_claims
			WHERE upload_id = $1::uuid FOR UPDATE`, id).Scan(&locked); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM ligo_message_media WHERE message_id = $1::uuid`, messageID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM ligo_message_reactions WHERE message_id = $1::uuid`, messageID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE ligo_messages SET body = '', deleted_at = clock_timestamp()
		WHERE id = $1::uuid`, messageID); err != nil {
		return nil, err
	}
	retired := make([]string, 0, len(ids))
	for _, id := range ids {
		result, err := tx.Exec(ctx, `UPDATE nodo_upload_claims AS claim SET retired_at = now()
			WHERE claim.upload_id = $1::uuid AND claim.retired_at IS NULL
			AND NOT EXISTS (SELECT 1 FROM fluo_post_media media WHERE media.upload_id = claim.upload_id)
			AND NOT EXISTS (SELECT 1 FROM ligo_message_media media WHERE media.upload_id = claim.upload_id)`, id)
		if err != nil {
			return nil, err
		}
		if result.RowsAffected() > 0 {
			retired = append(retired, id)
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE ligo_conversations SET updated_at = now() WHERE id = $1::uuid`, conversationID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `SELECT pg_notify('ligo_activity', $1)`, conversationID); err != nil {
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
	var locked string
	err = tx.QueryRow(ctx, `SELECT m.id::text FROM ligo_messages m
		JOIN ligo_members member ON member.conversation_id = m.conversation_id AND member.user_id = $1::uuid
		WHERE m.id = $2::uuid AND m.conversation_id = $3::uuid
		AND m.created_at >= member.joined_at AND m.deleted_at IS NULL FOR SHARE OF m`,
		actorID, messageID, conversationID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.Message{}, ligo.ErrNotFound
	}
	if err != nil {
		return ligo.Message{}, err
	}
	var result pgconn.CommandTag
	if active {
		result, err = tx.Exec(ctx, `INSERT INTO ligo_message_reactions (message_id, user_id, emoji)
			VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT DO NOTHING`, messageID, actorID, emoji)
	} else {
		result, err = tx.Exec(ctx, `DELETE FROM ligo_message_reactions
			WHERE message_id = $1::uuid AND user_id = $2::uuid AND emoji = $3`, messageID, actorID, emoji)
	}
	if err != nil {
		return ligo.Message{}, err
	}
	if result.RowsAffected() > 0 {
		if _, err := tx.Exec(ctx, `SELECT pg_notify('ligo_activity', $1)`, conversationID); err != nil {
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
	if read {
		result, err = tx.Exec(ctx, `UPDATE ligo_members lm
			SET last_read_message_id = $3::uuid,
			last_delivered_message_id = GREATEST(COALESCE(lm.last_delivered_message_id, $3::uuid), $3::uuid)
			FROM ligo_messages m
			WHERE lm.conversation_id = $1::uuid AND lm.user_id = $2::uuid
			AND m.id = $3::uuid AND m.conversation_id = lm.conversation_id
			AND m.created_at >= lm.joined_at
			AND (lm.last_read_message_id IS NULL OR lm.last_read_message_id < $3::uuid)`,
			conversationID, actorID, messageID)
	} else {
		result, err = tx.Exec(ctx, `UPDATE ligo_members lm
			SET last_delivered_message_id = $3::uuid
			FROM ligo_messages m
			WHERE lm.conversation_id = $1::uuid AND lm.user_id = $2::uuid
			AND m.id = $3::uuid AND m.conversation_id = lm.conversation_id
			AND m.created_at >= lm.joined_at
			AND (lm.last_delivered_message_id IS NULL OR lm.last_delivered_message_id < $3::uuid)`,
			conversationID, actorID, messageID)
	}
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		var accessible bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ligo_members lm
			JOIN ligo_messages m ON m.conversation_id = lm.conversation_id
			WHERE lm.conversation_id = $1::uuid AND lm.user_id = $2::uuid
			AND m.id = $3::uuid AND m.created_at >= lm.joined_at)`,
			conversationID, actorID, messageID).Scan(&accessible); err != nil {
			return err
		}
		if !accessible {
			return ligo.ErrNotFound
		}
	} else if _, err := tx.Exec(ctx, `SELECT pg_notify('ligo_activity', $1)`, conversationID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (store *Ligo) MemberIDs(ctx context.Context, conversationID string) ([]string, error) {
	rows, err := store.pool.Query(ctx, `SELECT user_id::text FROM ligo_members WHERE conversation_id = $1::uuid`, conversationID)
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
