package postgres

// Stores Ligo reactions, read receipts, and member lookups
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

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
	changed, err := writeReaction(ctx, tx, actorID, messageID, emoji, active)
	if err != nil {
		return ligo.Message{}, err
	}
	if changed {
		if err := jetNotify(ctx, tx, "ligo_activity", conversationID); err != nil {
			return ligo.Message{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return ligo.Message{}, err
	}
	return store.message(ctx, actorID, messageID)
}

func writeReaction(ctx context.Context, tx pgx.Tx, actorID, messageID, emoji string, active bool) (bool, error) {
	reactions := table.LigoMessageReactions
	if active {
		result, err := jetExec(ctx, tx, reactions.INSERT(reactions.MessageID, reactions.UserID, reactions.Emoji).
			VALUES(jetUUID(messageID), jetUUID(actorID), jetpg.String(emoji)).ON_CONFLICT().DO_NOTHING())
		return result.RowsAffected() > 0, err
	}
	result, err := jetExec(ctx, tx, reactions.DELETE().WHERE(jetpg.AND(
		reactions.MessageID.EQ(jetUUID(messageID)), reactions.UserID.EQ(jetUUID(actorID)),
		reactions.Emoji.EQ(jetpg.String(emoji)),
	)))
	return result.RowsAffected() > 0, err
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
	result, err := updateReceipt(ctx, tx, actorID, conversationID, messageID, read)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		accessible, err := receiptTargetAccessible(ctx, tx, actorID, conversationID, messageID)
		if err != nil {
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

func updateReceipt(ctx context.Context, tx pgx.Tx, actorID, conversationID, messageID string, read bool) (pgconn.CommandTag, error) {
	members := table.LigoMembers.AS("lm")
	messages := table.LigoMessages.AS("m")
	identity := jetpg.AND(
		members.ConversationID.EQ(jetUUID(conversationID)),
		members.UserID.EQ(jetUUID(actorID)),
		messages.ID.EQ(jetUUID(messageID)),
		messages.ConversationID.EQ(members.ConversationID),
		messages.CreatedAt.GT_EQ(members.JoinedAt),
	)
	if read {
		return jetExec(ctx, tx, members.UPDATE().SET(
			members.LastReadMessageID.SET(messages.ID),
			members.LastDeliveredMessageID.SET(jetpg.RawString("GREATEST(COALESCE(lm.last_delivered_message_id, m.id), m.id)")),
		).FROM(messages).WHERE(jetpg.AND(identity,
			jetpg.OR(members.LastReadMessageID.IS_NULL(), members.LastReadMessageID.LT(messages.ID)),
		)))
	}
	return jetExec(ctx, tx, members.UPDATE().SET(
		members.LastDeliveredMessageID.SET(messages.ID),
	).FROM(messages).WHERE(jetpg.AND(identity,
		jetpg.OR(members.LastDeliveredMessageID.IS_NULL(), members.LastDeliveredMessageID.LT(messages.ID)),
	)))
}

func receiptTargetAccessible(ctx context.Context, tx pgx.Tx, actorID, conversationID, messageID string) (bool, error) {
	members := table.LigoMembers.AS("lm")
	messages := table.LigoMessages.AS("m")
	query := jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(members.UserID).
		FROM(members.INNER_JOIN(messages, messages.ConversationID.EQ(members.ConversationID))).
		WHERE(jetpg.AND(
			members.ConversationID.EQ(jetUUID(conversationID)), members.UserID.EQ(jetUUID(actorID)),
			messages.ID.EQ(jetUUID(messageID)), messages.CreatedAt.GT_EQ(members.JoinedAt),
		))))
	var accessible bool
	err := jetQueryRow(ctx, tx, query).Scan(&accessible)
	return accessible, err
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
