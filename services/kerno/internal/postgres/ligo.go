package postgres

// Stores Ligo conversations and manages group membership
import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Ligo struct {
	pool *pgxpool.Pool
}

func NewLigo(pool *pgxpool.Pool) *Ligo {
	return &Ligo{pool: pool}
}

func (store *Ligo) SearchUsers(ctx context.Context, actorID, search string) ([]ligo.User, error) {
	literal := escapeLikeLiteral(search)
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
	if err := ensureConversationParticipants(ctx, tx, ids); err != nil {
		return ligo.Conversation{}, err
	}
	id, err := insertConversation(ctx, tx, actorID, ids, input)
	if err != nil {
		return ligo.Conversation{}, err
	}
	if err := addConversationMembers(ctx, tx, id, ids); err != nil {
		return ligo.Conversation{}, err
	}
	if err := jetNotify(ctx, tx, "ligo_activity", id); err != nil {
		return ligo.Conversation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ligo.Conversation{}, err
	}
	return store.GetConversation(ctx, actorID, id)
}

func ensureConversationParticipants(ctx context.Context, tx pgx.Tx, ids []string) error {
	users := table.Users
	var existing int
	err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(users.ID)).FROM(users).
		WHERE(users.ID.IN(jetUUIDList(ids)...))).Scan(&existing)
	if err != nil {
		return err
	}
	if existing != len(ids) {
		return ligo.ErrNotFound
	}
	return nil
}

func insertConversation(ctx context.Context, tx pgx.Tx, actorID string, participantIDs []string, input ligo.NewConversation) (string, error) {
	conversations := table.LigoConversations
	var id string
	var statement jetpg.InsertStatement

	switch input.Kind {
	case "duo":
		statement = conversations.INSERT(conversations.Kind, conversations.CreatedBy, conversations.DuoLow, conversations.DuoHigh).
			VALUES(jetpg.String("duo"), jetUUID(actorID), jetUUID(participantIDs[0]), jetUUID(participantIDs[1])).
			ON_CONFLICT(conversations.DuoLow, conversations.DuoHigh).
			DO_UPDATE(jetpg.SET(conversations.DuoLow.SET(conversations.EXCLUDED.DuoLow)))
	case "self":
		statement = conversations.INSERT(conversations.Kind, conversations.CreatedBy).
			VALUES(jetpg.String("self"), jetUUID(actorID)).
			ON_CONFLICT(conversations.CreatedBy).WHERE(conversations.Kind.EQ(jetpg.String("self"))).
			DO_UPDATE(jetpg.SET(conversations.CreatedBy.SET(conversations.EXCLUDED.CreatedBy)))
	default:
		statement = conversations.INSERT(conversations.Kind, conversations.Title, conversations.CreatedBy).
			VALUES(jetpg.String("group"), jetpg.String(input.Title), jetUUID(actorID))
	}
	err := jetQueryRow(ctx, tx, statement.RETURNING(jetpg.CAST(conversations.ID).AS_TEXT())).Scan(&id)
	return id, err
}

func addConversationMembers(ctx context.Context, tx pgx.Tx, conversationID string, participantIDs []string) error {
	members := table.LigoMembers
	for _, userID := range participantIDs {
		if _, err := jetExec(ctx, tx, members.INSERT(members.ConversationID, members.UserID).
			VALUES(jetUUID(conversationID), jetUUID(userID)).ON_CONFLICT().DO_NOTHING()); err != nil {
			return err
		}
	}
	return nil
}

func (store *Ligo) AddMembers(ctx context.Context, actorID, conversationID string, memberIDs []string) (ligo.Conversation, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return ligo.Conversation{}, err
	}
	defer tx.Rollback(ctx)

	creator, err := lockGroupCreator(ctx, tx, conversationID)
	if err != nil {
		return ligo.Conversation{}, err
	}
	if creator != actorID {
		return ligo.Conversation{}, ligo.ErrForbidden
	}

	total, alreadyMembers, err := countGroupMembers(ctx, tx, conversationID, memberIDs)
	if err != nil {
		return ligo.Conversation{}, err
	}
	if total+len(memberIDs)-alreadyMembers > 25 {
		return ligo.Conversation{}, ligo.ErrInvalid
	}
	if err := ensureUsersExist(ctx, tx, memberIDs); err != nil {
		return ligo.Conversation{}, err
	}
	if alreadyMembers == len(memberIDs) {
		if err := tx.Commit(ctx); err != nil {
			return ligo.Conversation{}, err
		}
		return store.GetConversation(ctx, actorID, conversationID)
	}
	if err := insertGroupMembers(ctx, tx, conversationID, memberIDs); err != nil {
		return ligo.Conversation{}, err
	}
	if err := publishConversationActivity(ctx, tx, conversationID); err != nil {
		return ligo.Conversation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ligo.Conversation{}, err
	}
	return store.GetConversation(ctx, actorID, conversationID)
}

func lockGroupCreator(ctx context.Context, tx pgx.Tx, conversationID string) (string, error) {
	conversations := table.LigoConversations
	var creator string
	err := jetQueryRow(ctx, tx, conversations.SELECT(jetpg.CAST(conversations.CreatedBy).AS_TEXT()).
		WHERE(jetpg.AND(conversations.ID.EQ(jetUUID(conversationID)), conversations.Kind.EQ(jetpg.String("group")))).
		FOR(jetpg.UPDATE())).Scan(&creator)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ligo.ErrNotFound
	}
	return creator, err
}

func countGroupMembers(ctx context.Context, tx pgx.Tx, conversationID string, memberIDs []string) (int, int, error) {
	members := table.LigoMembers
	memberCount := jetpg.RawInt("count(*) FILTER (WHERE user_id = ANY(#member_ids::uuid[]))",
		jetpg.RawArgs{"#member_ids": memberIDs})
	var total, alreadyMembers int
	err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(members.UserID), memberCount).FROM(members).
		WHERE(members.ConversationID.EQ(jetUUID(conversationID)))).Scan(&total, &alreadyMembers)
	return total, alreadyMembers, err
}

func ensureUsersExist(ctx context.Context, tx pgx.Tx, userIDs []string) error {
	if len(userIDs) == 0 {
		return nil
	}
	users := table.Users
	var found int
	err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(users.ID)).FROM(users).
		WHERE(users.ID.IN(jetUUIDList(userIDs)...))).Scan(&found)
	if err != nil {
		return err
	}
	if found != len(userIDs) {
		return ligo.ErrNotFound
	}
	return nil
}

func insertGroupMembers(ctx context.Context, tx pgx.Tx, conversationID string, memberIDs []string) error {
	members := table.LigoMembers
	for _, userID := range memberIDs {
		if _, err := jetExec(ctx, tx, members.INSERT(members.ConversationID, members.UserID).
			VALUES(jetUUID(conversationID), jetUUID(userID)).ON_CONFLICT().DO_NOTHING()); err != nil {
			return err
		}
	}
	return nil
}
