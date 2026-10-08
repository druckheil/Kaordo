package postgres

// Stores compare-and-swap recovery bundles authenticated by the owner's existing signing key
import (
	"context"
	"errors"
	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func readRecovery(ctx context.Context, executor jetExecutor, ownerID string) (string, error) {
	t := table.CryptoRecovery
	var sealed string
	err := jetQueryRow(ctx, executor, t.SELECT(t.WrappedKeys).WHERE(t.UserID.EQ(jetUUID(ownerID)))).Scan(&sealed)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return sealed, err
}
func (s *Encryption) Recovery(ctx context.Context, ownerID string) (string, error) {
	return readRecovery(ctx, s.pool, ownerID)
}
func (s *Encryption) SetRecovery(ctx context.Context, ownerID string, input encryption.RecoveryUpdate) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockEncryptionOwner(ctx, tx, ownerID); err != nil {
		return err
	}
	identity, err := publicEncryptionIdentity(ctx, tx, ownerID)
	if err != nil {
		return err
	}
	if err := input.Verify(ownerID, identity.SigningPublicKey); err != nil {
		return err
	}
	previous, err := readRecovery(ctx, tx, ownerID)
	if err != nil {
		return err
	}
	if previous != input.ExpectedWrappedKeys {
		return encryption.ErrConflict
	}
	t := table.CryptoRecovery
	if _, err := jetExec(ctx, tx, t.INSERT(t.UserID, t.WrappedKeys).VALUES(jetUUID(ownerID), jetpg.String(input.WrappedKeys)).
		ON_CONFLICT(t.UserID).DO_UPDATE(jetpg.SET(t.WrappedKeys.SET(t.EXCLUDED.WrappedKeys)))); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
