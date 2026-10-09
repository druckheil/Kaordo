package postgres

// Persists alert delivery cursors and writes administrator notices into their Saved messages
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// AlertCursor returns the last delivered event sequence for a host, or zero before the first.
func (store *Admin) AlertCursor(ctx context.Context, host string) (int64, error) {
	cursors := table.RegadoAlertCursors
	var sequence int64
	err := jetQueryRow(ctx, store.pool, cursors.SELECT(cursors.Sequence).WHERE(cursors.Host.EQ(jetpg.String(host)))).Scan(&sequence)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return sequence, err
}

func (store *Admin) SetAlertCursor(ctx context.Context, host string, sequence int64) error {
	cursors := table.RegadoAlertCursors
	_, err := jetExec(ctx, store.pool, cursors.INSERT(cursors.Host, cursors.Sequence).
		VALUES(jetpg.String(host), jetpg.Int(sequence)).
		ON_CONFLICT(cursors.Host).DO_UPDATE(jetpg.SET(
		cursors.Sequence.SET(cursors.EXCLUDED.Sequence),
		cursors.UpdatedAt.SET(jetpg.RawTimestampz("now()")),
	)))
	return err
}

// NotifyAdministrators posts a plaintext system notice to every active administrator's Saved
// messages in one transaction, creating the conversation when it does not exist yet.
func (store *Admin) NotifyAdministrators(ctx context.Context, text string) error {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	users, roles := table.Users, table.UserRoles
	rows, err := jetQuery(ctx, tx, jetpg.SELECT(jetpg.CAST(users.ID).AS_TEXT()).
		FROM(users.INNER_JOIN(roles, roles.UserID.EQ(users.ID))).
		WHERE(jetpg.AND(roles.Role.EQ(jetpg.String("admin")), users.DisabledAt.IS_NULL())))
	if err != nil {
		return err
	}
	administrators, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, id := range administrators {
		if err := postSystemNotice(ctx, tx, id, text); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func postSystemNotice(ctx context.Context, tx pgx.Tx, userID, text string) error {
	conversationID, err := ensureSelfConversation(ctx, tx, userID)
	if err != nil {
		return err
	}
	if err := addConversationMembers(ctx, tx, conversationID, []string{userID}); err != nil {
		return err
	}
	messages := table.LigoMessages
	if _, err := jetExec(ctx, tx, messages.INSERT(messages.ConversationID, messages.SenderID, messages.ClientID, messages.Body, messages.SystemNotice).
		VALUES(jetUUID(conversationID), jetUUID(userID), jetUUID(uuid.Must(uuid.NewV7()).String()), jetpg.String(text), jetpg.Bool(true))); err != nil {
		return err
	}
	return publishConversationActivity(ctx, tx, conversationID)
}
