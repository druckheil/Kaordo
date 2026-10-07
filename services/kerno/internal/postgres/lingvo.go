package postgres

// Owns dictionary access, settings and common Lingvo transaction boundaries
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/lingvo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Lingvo struct{ pool *pgxpool.Pool }

func NewLingvo(pool *pgxpool.Pool) *Lingvo { return &Lingvo{pool: pool} }

func lingvoDictionaryQuery(actorID string) jetpg.SelectStatement {
	d := table.LingvoDictionaries
	return jetpg.SELECT(d.ID, d.LearningLanguage, d.NativeLanguage, d.DailyGoal, d.TimeZone, d.CreatedAt).
		FROM(d).WHERE(d.UserID.EQ(jetUUID(actorID)))
}

func scanLingvoDictionary(row scanner) (lingvo.Dictionary, error) {
	var d lingvo.Dictionary
	err := row.Scan(&d.ID, &d.LearningLanguage, &d.NativeLanguage, &d.DailyGoal, &d.TimeZone, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		err = lingvo.ErrNotFound
	}
	return d, err
}

func getLingvoDictionary(ctx context.Context, executor jetExecutor, actorID, dictionaryID string, lock bool) (lingvo.Dictionary, error) {
	d := table.LingvoDictionaries
	query := lingvoDictionaryQuery(actorID).WHERE(jetpg.AND(d.UserID.EQ(jetUUID(actorID)), d.ID.EQ(jetUUID(dictionaryID))))
	if lock {
		query = query.FOR(jetpg.UPDATE())
	}
	return scanLingvoDictionary(jetQueryRow(ctx, executor, query))
}

func (s *Lingvo) Dictionaries(ctx context.Context, actorID string) ([]lingvo.Dictionary, error) {
	rows, err := jetQuery(ctx, s.pool, lingvoDictionaryQuery(actorID).ORDER_BY(table.LingvoDictionaries.CreatedAt.ASC()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]lingvo.Dictionary, 0)
	for rows.Next() {
		item, err := scanLingvoDictionary(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Lingvo) CreateDictionary(ctx context.Context, actorID string, input lingvo.NewDictionary) (lingvo.Dictionary, error) {
	if err := input.Validate(); err != nil {
		return lingvo.Dictionary{}, err
	}
	d := table.LingvoDictionaries
	_, err := jetExec(ctx, s.pool, d.INSERT(d.UserID, d.LearningLanguage, d.NativeLanguage, d.TimeZone).
		VALUES(jetUUID(actorID), jetpg.String(input.LearningLanguage), jetpg.String(input.NativeLanguage), jetpg.String(input.TimeZone)).
		ON_CONFLICT(d.UserID, d.LearningLanguage, d.NativeLanguage).DO_NOTHING())
	if err != nil {
		return lingvo.Dictionary{}, err
	}
	// Existing dictionaries keep their preferences when selected again
	return scanLingvoDictionary(jetQueryRow(ctx, s.pool, lingvoDictionaryQuery(actorID).
		WHERE(jetpg.AND(d.UserID.EQ(jetUUID(actorID)), d.LearningLanguage.EQ(jetpg.String(input.LearningLanguage)),
			d.NativeLanguage.EQ(jetpg.String(input.NativeLanguage))))))
}

func (s *Lingvo) UpdateSettings(ctx context.Context, actorID, dictionaryID string, input lingvo.Settings) (lingvo.Dictionary, error) {
	if err := input.Validate(); err != nil {
		return lingvo.Dictionary{}, err
	}
	d := table.LingvoDictionaries
	return scanLingvoDictionary(jetQueryRow(ctx, s.pool, d.UPDATE(d.DailyGoal, d.TimeZone).
		SET(input.DailyGoal, input.TimeZone).WHERE(jetpg.AND(d.ID.EQ(jetUUID(dictionaryID)), d.UserID.EQ(jetUUID(actorID)))).
		RETURNING(d.ID, d.LearningLanguage, d.NativeLanguage, d.DailyGoal, d.TimeZone, d.CreatedAt)))
}

// Locking the owned dictionary serializes capacity checks and multi-card writes
func (s *Lingvo) beginDictionary(ctx context.Context, actorID, dictionaryID string) (pgx.Tx, lingvo.Dictionary, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, lingvo.Dictionary{}, err
	}
	d, err := getLingvoDictionary(ctx, tx, actorID, dictionaryID, true)
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, lingvo.Dictionary{}, err
	}
	return tx, d, nil
}

func checkLingvoFolder(ctx context.Context, executor jetExecutor, dictionaryID string, folderID *string) error {
	if folderID == nil {
		return nil
	}
	f := table.LingvoFolders
	var found bool
	err := jetQueryRow(ctx, executor, jetpg.SELECT(jetpg.EXISTS(f.SELECT(f.ID).
		WHERE(jetpg.AND(f.ID.EQ(jetUUID(*folderID)), f.DictionaryID.EQ(jetUUID(dictionaryID))))))).Scan(&found)
	if err != nil {
		return err
	}
	if !found {
		return lingvo.ErrNotFound
	}
	return nil
}

func lingvoCapacity(ctx context.Context, tx pgx.Tx, dictionaryID string) error {
	c := table.LingvoCards
	var count int
	if err := jetQueryRow(ctx, tx, c.SELECT(jetpg.COUNT(c.ID)).WHERE(c.DictionaryID.EQ(jetUUID(dictionaryID)))).Scan(&count); err != nil {
		return err
	}
	if count > 10_000 {
		return lingvo.ErrLimit
	}
	return nil
}

var _ lingvo.Store = (*Lingvo)(nil)
