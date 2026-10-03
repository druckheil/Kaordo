package postgres

// Deletes Ligo messages and retires media that is no longer referenced
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func (store *Ligo) DeleteMessage(ctx context.Context, actorID, conversationID, messageID string) ([]string, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	deleted, err := lockMessageForDeletion(ctx, tx, actorID, conversationID, messageID)
	if err != nil {
		return nil, err
	}
	if deleted {
		return []string{}, tx.Commit(ctx)
	}

	mediaIDs, err := messageMediaIDs(ctx, tx, messageID)
	if err != nil {
		return nil, err
	}
	if err := lockMessageMediaClaims(ctx, tx, mediaIDs); err != nil {
		return nil, err
	}
	if err := removeMessageReferences(ctx, tx, messageID); err != nil {
		return nil, err
	}
	retiredIDs, err := retireMessageMediaClaims(ctx, tx, mediaIDs)
	if err != nil {
		return nil, err
	}
	if err := publishConversationActivity(ctx, tx, conversationID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return retiredIDs, nil
}

func lockMessageForDeletion(ctx context.Context, tx pgx.Tx, actorID, conversationID, messageID string) (bool, error) {
	messages := table.LigoMessages.AS("m")
	members := table.LigoMembers.AS("member")
	var deleted bool
	err := jetQueryRow(ctx, tx, messages.SELECT(jetpg.RawBool("m.deleted_at IS NOT NULL")).
		FROM(messages.INNER_JOIN(members, jetpg.AND(
			members.ConversationID.EQ(messages.ConversationID), members.UserID.EQ(jetUUID(actorID)),
		))).WHERE(jetpg.AND(
		messages.ID.EQ(jetUUID(messageID)), messages.ConversationID.EQ(jetUUID(conversationID)),
		messages.SenderID.EQ(jetUUID(actorID)), messages.SystemNotice.IS_FALSE(),
	)).FOR(jetpg.UPDATE().OF(messages))).Scan(&deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ligo.ErrNotFound
	}
	return deleted, err
}

func messageMediaIDs(ctx context.Context, tx pgx.Tx, messageID string) ([]string, error) {
	messageMedia := table.LigoMessageMedia
	rows, err := jetQuery(ctx, tx, messageMedia.SELECT(jetpg.CAST(messageMedia.UploadID).AS_TEXT()).
		WHERE(messageMedia.MessageID.EQ(jetUUID(messageID))).ORDER_BY(messageMedia.UploadID.ASC()))
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

func lockMessageMediaClaims(ctx context.Context, tx pgx.Tx, mediaIDs []string) error {
	claims := table.NodoUploadClaims
	for _, id := range mediaIDs {
		var locked string
		if err := jetQueryRow(ctx, tx, claims.SELECT(jetpg.CAST(claims.UploadID).AS_TEXT()).
			WHERE(claims.UploadID.EQ(jetUUID(id))).FOR(jetpg.UPDATE())).Scan(&locked); err != nil {
			return err
		}
	}
	return nil
}

func removeMessageReferences(ctx context.Context, tx pgx.Tx, messageID string) error {
	messageMedia := table.LigoMessageMedia
	if _, err := jetExec(ctx, tx, messageMedia.DELETE().WHERE(messageMedia.MessageID.EQ(jetUUID(messageID)))); err != nil {
		return err
	}

	reactions := table.LigoMessageReactions
	if _, err := jetExec(ctx, tx, reactions.DELETE().WHERE(reactions.MessageID.EQ(jetUUID(messageID)))); err != nil {
		return err
	}

	messages := table.LigoMessages
	_, err := jetExec(ctx, tx, messages.UPDATE().SET(
		messages.Body.SET(jetpg.String("")),
		messages.DeletedAt.SET(jetpg.RawTimestampz("clock_timestamp()")),
	).WHERE(messages.ID.EQ(jetUUID(messageID))))
	return err
}

func retireMessageMediaClaims(ctx context.Context, tx pgx.Tx, mediaIDs []string) ([]string, error) {
	retiredIDs := make([]string, 0, len(mediaIDs))
	for _, id := range mediaIDs {
		retired, err := retireUnreferencedUpload(ctx, tx, id)
		if err != nil {
			return nil, err
		}
		if retired {
			retiredIDs = append(retiredIDs, id)
		}
	}
	return retiredIDs, nil
}
