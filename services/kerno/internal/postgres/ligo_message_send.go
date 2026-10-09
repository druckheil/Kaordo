package postgres

// Sends Ligo messages with idempotency, rate limits, and media claims
import (
	"context"
	"errors"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func (store *Ligo) Send(ctx context.Context, actorID, conversationID string, input ligo.NewMessage, media []ligo.Media) (ligo.Message, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return ligo.Message{}, err
	}
	defer tx.Rollback(ctx)

	if err := lockSendMembership(ctx, tx, actorID, conversationID); err != nil {
		return ligo.Message{}, err
	}
	if envelope, parseErr := encryption.ParseText(input.Text); parseErr == nil {
		audience, err := encryptionAudience(ctx, tx, actorID, "ligo", conversationID, false)
		if err != nil {
			return ligo.Message{}, err
		}
		if envelope.Context != "ligo:"+conversationID+":"+input.ClientID {
			return ligo.Message{}, encryption.ErrInvalid
		}
		if err := verifyContentForAudience(ctx, tx, actorID, envelope, audience, "ligo:"); err != nil {
			return ligo.Message{}, err
		}
	}
	if id, found, err := existingMessageID(ctx, tx, actorID, conversationID, input.ClientID); err != nil {
		return ligo.Message{}, err
	} else if found {
		return store.finishIdempotentSend(ctx, tx, actorID, id)
	}
	if err := enforceMessageRateLimit(ctx, tx, actorID); err != nil {
		return ligo.Message{}, err
	}
	if err := claimMessageMedia(ctx, tx, actorID, media); err != nil {
		return ligo.Message{}, err
	}

	id, alreadySent, err := insertMessage(ctx, tx, actorID, conversationID, input)
	if err != nil {
		return ligo.Message{}, err
	}
	if alreadySent {
		return store.finishIdempotentSend(ctx, tx, actorID, id)
	}
	if err := attachMessageMedia(ctx, tx, id, media); err != nil {
		return ligo.Message{}, err
	}
	if err := publishConversationActivity(ctx, tx, conversationID); err != nil {
		return ligo.Message{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ligo.Message{}, err
	}
	return store.message(ctx, actorID, id)
}

func lockSendMembership(ctx context.Context, tx pgx.Tx, actorID, conversationID string) error {
	// Match membership changes' lock order so the join timestamp determines message visibility.
	conversations := table.LigoConversations
	var lockedConversation string
	err := jetQueryRow(ctx, tx, conversations.SELECT(jetpg.CAST(conversations.ID).AS_TEXT()).
		WHERE(conversations.ID.EQ(jetUUID(conversationID))).FOR(jetpg.UPDATE())).Scan(&lockedConversation)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.ErrNotFound
	}
	if err != nil {
		return err
	}

	members := table.LigoMembers
	var joined time.Time
	err = jetQueryRow(ctx, tx, members.SELECT(members.JoinedAt).
		WHERE(jetpg.AND(members.ConversationID.EQ(jetUUID(conversationID)), members.UserID.EQ(jetUUID(actorID)))).
		FOR(jetpg.SHARE())).Scan(&joined)
	if errors.Is(err, pgx.ErrNoRows) {
		return ligo.ErrNotFound
	}
	return err
}

func existingMessageID(ctx context.Context, tx pgx.Tx, actorID, conversationID, clientID string) (string, bool, error) {
	messages := table.LigoMessages
	var id string
	err := jetQueryRow(ctx, tx, messages.SELECT(jetpg.CAST(messages.ID).AS_TEXT()).WHERE(jetpg.AND(
		messages.SenderID.EQ(jetUUID(actorID)), messages.ClientID.EQ(jetUUID(clientID)),
		messages.ConversationID.EQ(jetUUID(conversationID)),
	))).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return id, err == nil, err
}

func (store *Ligo) finishIdempotentSend(ctx context.Context, tx pgx.Tx, actorID, messageID string) (ligo.Message, error) {
	if err := tx.Commit(ctx); err != nil {
		return ligo.Message{}, err
	}
	return store.message(ctx, actorID, messageID)
}

func enforceMessageRateLimit(ctx context.Context, tx pgx.Tx, actorID string) error {
	if err := jetAdvisoryLock(ctx, tx, jetpg.RawString("pg_advisory_xact_lock(hashtext(#actor))", jetpg.RawArgs{"#actor": actorID})); err != nil {
		return err
	}

	messages := table.LigoMessages
	var recent int
	err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(messages.ID)).FROM(messages).WHERE(jetpg.AND(
		messages.SenderID.EQ(jetUUID(actorID)), messages.CreatedAt.GT(jetpg.RawTimestampz("now() - interval '1 minute'")),
	))).Scan(&recent)
	if err != nil {
		return err
	}
	if recent >= 60 {
		return ligo.ErrRateLimited
	}
	return nil
}

func claimMessageMedia(ctx context.Context, tx pgx.Tx, actorID string, media []ligo.Media) error {
	ids := make([]string, len(media))
	for index, item := range media {
		ids[index] = item.ID
	}
	claimed, err := claimUploads(ctx, tx, actorID, ids)
	if err != nil {
		return err
	}
	if !claimed {
		return ligo.ErrMediaOwner
	}
	return nil
}

func insertMessage(ctx context.Context, tx pgx.Tx, actorID, conversationID string, input ligo.NewMessage) (string, bool, error) {
	messages := table.LigoMessages
	var id string
	err := jetQueryRow(ctx, tx, messages.INSERT(messages.ConversationID, messages.SenderID, messages.ClientID, messages.Body).
		VALUES(jetUUID(conversationID), jetUUID(actorID), jetUUID(input.ClientID), jetpg.String(input.Text)).
		ON_CONFLICT(messages.SenderID, messages.ClientID).DO_NOTHING().
		RETURNING(jetpg.CAST(messages.ID).AS_TEXT())).Scan(&id)
	if !errors.Is(err, pgx.ErrNoRows) {
		return id, false, err
	}

	var existingConversation string
	err = jetQueryRow(ctx, tx, messages.SELECT(jetpg.CAST(messages.ID).AS_TEXT(),
		jetpg.CAST(messages.ConversationID).AS_TEXT()).WHERE(jetpg.AND(
		messages.SenderID.EQ(jetUUID(actorID)), messages.ClientID.EQ(jetUUID(input.ClientID)),
	))).Scan(&id, &existingConversation)
	if err != nil {
		return "", false, err
	}
	if existingConversation != conversationID {
		return "", false, ligo.ErrInvalid
	}
	return id, true, nil
}

func attachMessageMedia(ctx context.Context, tx pgx.Tx, messageID string, media []ligo.Media) error {
	messageMedia := table.LigoMessageMedia
	for position, item := range media {
		_, err := jetExec(ctx, tx, messageMedia.INSERT(messageMedia.MessageID, messageMedia.UploadID, messageMedia.Position,
			messageMedia.Kind, messageMedia.MimeType, messageMedia.Filename, messageMedia.Width, messageMedia.Height,
			messageMedia.SizeBytes, messageMedia.AltText).VALUES(jetUUID(messageID), jetUUID(item.ID), jetpg.Int(int64(position)),
			jetpg.String(item.Kind), jetpg.String(item.MimeType), jetpg.String(item.Filename), jetpg.Int(int64(item.Width)),
			jetpg.Int(int64(item.Height)), jetpg.Int(item.Size), jetpg.String(item.AltText)))
		if err != nil {
			return err
		}
	}
	return nil
}

func publishConversationActivity(ctx context.Context, tx pgx.Tx, conversationID string) error {
	conversations := table.LigoConversations
	if _, err := jetExec(ctx, tx, conversations.UPDATE().SET(
		conversations.UpdatedAt.SET(jetpg.RawTimestampz("now()")),
	).WHERE(conversations.ID.EQ(jetUUID(conversationID)))); err != nil {
		return err
	}
	return notifyLigoActivity(ctx, tx, conversationID)
}
