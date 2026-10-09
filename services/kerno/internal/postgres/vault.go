package postgres

// Commits encrypted private record batches atomically without opening user content
import (
	"context"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	"github.com/druckheil/Kaordo/services/kerno/internal/vault"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Vault struct{ pool *pgxpool.Pool }

func NewVault(pool *pgxpool.Pool) *Vault { return &Vault{pool} }
func readPrivateRecords(ctx context.Context, executor jetExecutor, actorID string, tags []string) ([]vault.Record, error) {
	items := make([]vault.Record, 0)
	if len(tags) == 0 {
		return items, nil
	}
	if len(tags) > 502 {
		return nil, encryption.ErrInvalid
	}
	expressions := make([]jetpg.Expression, 0, len(tags))
	for _, tag := range tags {
		if !encryption.ValidIndex(tag) {
			return nil, encryption.ErrInvalid
		}
		expressions = append(expressions, jetpg.String(tag))
	}
	r := table.PrivateRecords
	rows, err := jetQuery(ctx, executor, r.SELECT(r.Tag, r.Revision, r.Nonce, r.Ciphertext).WHERE(jetpg.AND(r.UserID.EQ(jetUUID(actorID)), r.Tag.IN(expressions...))))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var record vault.Record
		if err := rows.Scan(&record.Tag, &record.Revision, &record.Nonce, &record.Ciphertext); err != nil {
			return nil, err
		}
		items = append(items, record)
	}
	return items, rows.Err()
}
func (s *Vault) Read(ctx context.Context, actorID string, tags []string) ([]vault.Record, error) {
	return readPrivateRecords(ctx, s.pool, actorID, tags)
}
func (s *Vault) Commit(ctx context.Context, actorID string, input vault.Transaction) ([]vault.Record, error) {
	if err := input.Validate(); err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := lockEncryptionOwner(ctx, tx, actorID); err != nil {
		return nil, err
	}
	tags := make([]string, 0, len(input.Writes)+len(input.Deletes))
	for _, write := range input.Writes {
		tags = append(tags, write.Tag)
	}
	for _, item := range input.Deletes {
		tags = append(tags, item.Tag)
	}
	previous, err := readPrivateRecords(ctx, tx, actorID, tags)
	if err != nil {
		return nil, err
	}
	revisions := map[string]int64{}
	for _, item := range previous {
		revisions[item.Tag] = item.Revision
	}
	for _, write := range input.Writes {
		if revisions[write.Tag] != write.Revision {
			return nil, encryption.ErrConflict
		}
	}
	for _, item := range input.Deletes {
		if revisions[item.Tag] != item.Revision {
			return nil, encryption.ErrConflict
		}
	}
	r := table.PrivateRecords
	for _, write := range input.Writes {
		_, err := jetExec(ctx, tx, r.INSERT(r.UserID, r.Tag, r.Revision, r.Nonce, r.Ciphertext).VALUES(jetUUID(actorID), write.Tag, write.Revision+1, write.Nonce, write.Ciphertext).
			ON_CONFLICT(r.UserID, r.Tag).DO_UPDATE(jetpg.SET(r.Revision.SET(r.EXCLUDED.Revision), r.Nonce.SET(r.EXCLUDED.Nonce), r.Ciphertext.SET(r.EXCLUDED.Ciphertext))))
		if err != nil {
			return nil, err
		}
	}
	for _, item := range input.Deletes {
		if _, err := jetExec(ctx, tx, r.DELETE().WHERE(jetpg.AND(r.UserID.EQ(jetUUID(actorID)), r.Tag.EQ(jetpg.String(item.Tag))))); err != nil {
			return nil, err
		}
	}
	result, err := readPrivateRecords(ctx, tx, actorID, tags)
	if err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

var _ vault.Store = (*Vault)(nil)
