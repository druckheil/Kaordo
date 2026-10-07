package postgres

// Reads personal card pages and writes card content without resetting FSRS progress
import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/lingvo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func lingvoCardQuery(dictionaryID string) jetpg.SelectStatement {
	c := table.LingvoCards
	return c.SELECT(c.ID, c.DictionaryID, c.FolderID, c.Kind, c.Term, c.Translation, c.PartOfSpeech,
		c.Article, c.Plural, c.Grammar, c.Example, c.ExampleTranslation, c.Notes, c.SourceKey, c.Status,
		c.Schedule, c.Revision, c.CreatedAt).WHERE(c.DictionaryID.EQ(jetUUID(dictionaryID)))
}

func scanLingvoCard(row scanner) (lingvo.Card, error) {
	var c lingvo.Card
	var schedule []byte
	err := row.Scan(&c.ID, &c.DictionaryID, &c.FolderID, &c.Kind, &c.Term, &c.Translation, &c.PartOfSpeech,
		&c.Article, &c.Plural, &c.Grammar, &c.Example, &c.ExampleTranslation, &c.Notes, &c.SourceKey,
		&c.Status, &schedule, &c.Revision, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, lingvo.ErrNotFound
	}
	if err != nil {
		return c, err
	}
	return c, json.Unmarshal(schedule, &c.Schedule)
}

func getLingvoCard(ctx context.Context, executor jetExecutor, dictionaryID, cardID string) (lingvo.Card, error) {
	c := table.LingvoCards
	return scanLingvoCard(jetQueryRow(ctx, executor, lingvoCardQuery(dictionaryID).
		WHERE(jetpg.AND(c.DictionaryID.EQ(jetUUID(dictionaryID)), c.ID.EQ(jetUUID(cardID))))))
}

func lingvoCardWhere(dictionaryID string, filter lingvo.CardFilter) jetpg.BoolExpression {
	c := table.LingvoCards
	conditions := []jetpg.BoolExpression{c.DictionaryID.EQ(jetUUID(dictionaryID))}
	if filter.Kind != "" {
		conditions = append(conditions, c.Kind.EQ(jetpg.String(filter.Kind)))
	}
	if filter.Status != "" {
		conditions = append(conditions, c.Status.EQ(jetpg.String(filter.Status)))
	}
	if filter.FolderID == "none" {
		conditions = append(conditions, c.FolderID.IS_NULL())
	} else if filter.FolderID != "" {
		conditions = append(conditions, c.FolderID.EQ(jetUUID(filter.FolderID)))
	}
	if filter.Search != "" {
		// Treat user input literally rather than allowing LIKE wildcard expansion
		pattern := "%" + escapeLikeLiteral(filter.Search) + "%"
		conditions = append(conditions, jetpg.OR(jetpg.LOWER(c.Term).LIKE(jetpg.String(strings.ToLower(pattern))),
			jetpg.LOWER(c.Translation).LIKE(jetpg.String(strings.ToLower(pattern)))))
	}
	return jetpg.AND(conditions...)
}

func readLingvoCards(ctx context.Context, executor jetExecutor, query jetpg.SelectStatement) ([]lingvo.Card, error) {
	rows, err := jetQuery(ctx, executor, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := make([]lingvo.Card, 0)
	for rows.Next() {
		card, err := scanLingvoCard(rows)
		if err != nil {
			return nil, err
		}
		cards = append(cards, card)
	}
	return cards, rows.Err()
}

func (s *Lingvo) Cards(ctx context.Context, actorID, dictionaryID string, filter lingvo.CardFilter) (lingvo.CardPage, error) {
	if _, err := getLingvoDictionary(ctx, s.pool, actorID, dictionaryID, false); err != nil {
		return lingvo.CardPage{}, err
	}
	c := table.LingvoCards
	where := lingvoCardWhere(dictionaryID, filter)
	var page lingvo.CardPage
	if err := jetQueryRow(ctx, s.pool, c.SELECT(jetpg.COUNT(c.ID)).WHERE(where)).Scan(&page.Total); err != nil {
		return page, err
	}
	items, err := readLingvoCards(ctx, s.pool, lingvoCardQuery(dictionaryID).WHERE(where).
		ORDER_BY(c.CreatedAt.DESC(), c.ID.DESC()).LIMIT(int64(filter.Limit)).OFFSET(int64(filter.Offset)))
	page.Items = items
	return page, err
}

func (s *Lingvo) Study(ctx context.Context, actorID, dictionaryID string, filter lingvo.CardFilter) ([]lingvo.Card, error) {
	if _, err := getLingvoDictionary(ctx, s.pool, actorID, dictionaryID, false); err != nil {
		return nil, err
	}
	filter.Status = "active"
	c := table.LingvoCards
	return readLingvoCards(ctx, s.pool, lingvoCardQuery(dictionaryID).
		WHERE(jetpg.AND(lingvoCardWhere(dictionaryID, filter), c.DueAt.LT_EQ(jetpg.TimestampzT(time.Now().UTC())))).
		ORDER_BY(jetpg.RawInt("CASE WHEN schedule->>'state' = '0' THEN 1 ELSE 0 END").ASC(), c.DueAt.ASC(), c.ID.ASC()).LIMIT(50))
}

func lingvoJSON(value lingvo.Schedule) jetpg.Expression {
	// All supplied values are validated typed structs; json.Marshal cannot fail
	encoded, _ := json.Marshal(value)
	return jetpg.RawString("#value::jsonb", jetpg.RawArgs{"#value": string(encoded)})
}

func lingvoContentColumns() jetpg.ColumnList {
	c := table.LingvoCards
	return jetpg.ColumnList{c.FolderID, c.Kind, c.Term, c.Translation, c.PartOfSpeech, c.Article,
		c.Plural, c.Grammar, c.Example, c.ExampleTranslation, c.Notes, c.Status}
}

func lingvoContentValues(input lingvo.CardContent) []any {
	return []any{nullableUUID(input.FolderID), input.Kind, input.Term, input.Translation, input.PartOfSpeech,
		input.Article, input.Plural, input.Grammar, input.Example, input.ExampleTranslation, input.Notes, input.Status}
}

func (s *Lingvo) CreateCard(ctx context.Context, actorID, dictionaryID string, input lingvo.NewCard) (lingvo.Card, error) {
	input.Normalize()
	if !lingvo.ValidID(input.ID) {
		return lingvo.Card{}, lingvo.ErrInvalid
	}
	if err := input.Validate(); err != nil {
		return lingvo.Card{}, err
	}
	tx, _, err := s.beginDictionary(ctx, actorID, dictionaryID)
	if err != nil {
		return lingvo.Card{}, err
	}
	defer tx.Rollback(ctx)
	if err := checkLingvoFolder(ctx, tx, dictionaryID, input.FolderID); err != nil {
		return lingvo.Card{}, err
	}
	c := table.LingvoCards
	schedule := lingvo.NewSchedule(time.Now().UTC())
	columns := append(lingvoContentColumns(), c.ID, c.DictionaryID, c.Schedule, c.DueAt)
	values := append(lingvoContentValues(input.CardContent), jetUUID(input.ID), jetUUID(dictionaryID), lingvoJSON(schedule), schedule.Due)
	var id string
	err = jetQueryRow(ctx, tx, c.INSERT(columns).VALUES(values[0], values[1:]...).ON_CONFLICT(c.ID).DO_NOTHING().RETURNING(c.ID)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		card, err := getLingvoCard(ctx, tx, dictionaryID, input.ID)
		if errors.Is(err, lingvo.ErrNotFound) {
			return card, lingvo.ErrConflict
		}
		if err != nil {
			return card, err
		}
		if !reflect.DeepEqual(card.CardContent, input.CardContent) {
			return card, lingvo.ErrConflict
		}
		return card, tx.Commit(ctx)
	}
	if err != nil {
		return lingvo.Card{}, err
	}
	if err := lingvoCapacity(ctx, tx, dictionaryID); err != nil {
		return lingvo.Card{}, err
	}
	card, err := getLingvoCard(ctx, tx, dictionaryID, id)
	if err != nil {
		return card, err
	}
	return card, tx.Commit(ctx)
}

func (s *Lingvo) UpdateCard(ctx context.Context, actorID, dictionaryID, cardID string, input lingvo.CardUpdate) (lingvo.Card, error) {
	input.Normalize()
	if err := input.Validate(); err != nil {
		return lingvo.Card{}, err
	}
	tx, _, err := s.beginDictionary(ctx, actorID, dictionaryID)
	if err != nil {
		return lingvo.Card{}, err
	}
	defer tx.Rollback(ctx)
	if err := checkLingvoFolder(ctx, tx, dictionaryID, input.FolderID); err != nil {
		return lingvo.Card{}, err
	}
	c := table.LingvoCards
	columns := append(lingvoContentColumns(), c.Revision, c.UpdatedAt)
	values := append(lingvoContentValues(input.CardContent), input.Revision+1, time.Now().UTC())
	tag, err := jetExec(ctx, tx, c.UPDATE(columns).SET(values[0], values[1:]...).
		WHERE(jetpg.AND(c.DictionaryID.EQ(jetUUID(dictionaryID)), c.ID.EQ(jetUUID(cardID)), c.Revision.EQ(jetpg.Int(input.Revision)))))
	if err != nil {
		return lingvo.Card{}, err
	}
	if tag.RowsAffected() == 0 {
		return lingvo.Card{}, lingvo.ErrConflict
	}
	card, err := getLingvoCard(ctx, tx, dictionaryID, cardID)
	if err != nil {
		return card, err
	}
	return card, tx.Commit(ctx)
}

func (s *Lingvo) DeleteCard(ctx context.Context, actorID, dictionaryID, cardID string, revision int64) error {
	tx, _, err := s.beginDictionary(ctx, actorID, dictionaryID)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	c := table.LingvoCards
	tag, err := jetExec(ctx, tx, c.DELETE().WHERE(jetpg.AND(c.DictionaryID.EQ(jetUUID(dictionaryID)),
		c.ID.EQ(jetUUID(cardID)), c.Revision.EQ(jetpg.Int(revision)))))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return lingvo.ErrConflict
	}
	return tx.Commit(ctx)
}
