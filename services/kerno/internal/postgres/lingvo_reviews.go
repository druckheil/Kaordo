package postgres

// Applies idempotent FSRS reviews and restores the previous schedule on undo
import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/lingvo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func (s *Lingvo) Review(ctx context.Context, actorID, dictionaryID, cardID string, input lingvo.Review) (lingvo.ReviewResult, error) {
	if err := input.Validate(); err != nil {
		return lingvo.ReviewResult{}, err
	}
	tx, _, err := s.beginDictionary(ctx, actorID, dictionaryID)
	if err != nil {
		return lingvo.ReviewResult{}, err
	}
	defer tx.Rollback(ctx)
	card, err := getLingvoCard(ctx, tx, dictionaryID, cardID)
	if err != nil {
		return lingvo.ReviewResult{}, err
	}
	if (card.Kind == "phrase") != (input.Direction == "phrase") {
		return lingvo.ReviewResult{}, lingvo.ErrInvalid
	}
	result := lingvo.ReviewResult{ID: input.ID, Card: card}
	r := table.LingvoReviews
	var previousCardID *string
	var revision int64
	var rating int
	var direction string
	var undone *time.Time
	err = jetQueryRow(ctx, tx, r.SELECT(r.CardID, r.ResultingRevision, r.Rating, r.Direction, r.UndoneAt).
		WHERE(jetpg.AND(r.ID.EQ(jetUUID(input.ID)), r.DictionaryID.EQ(jetUUID(dictionaryID))))).
		Scan(&previousCardID, &revision, &rating, &direction, &undone)
	if err == nil {
		if previousCardID == nil || *previousCardID != card.ID || revision != input.Revision+1 || rating != input.Rating || direction != input.Direction || undone != nil {
			return result, lingvo.ErrConflict
		}
		return result, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	if card.Status != "active" || card.Revision != input.Revision {
		return result, lingvo.ErrConflict
	}
	now := time.Now().UTC()
	// A fresh card or a due card can be reviewed; clients cannot skip future intervals
	if card.Schedule.Due.After(now.Add(2 * time.Second)) {
		return result, lingvo.ErrConflict
	}
	schedule, err := lingvo.NextSchedule(card.Schedule, input.Rating, now)
	if err != nil {
		return result, err
	}
	if _, err := jetExec(ctx, tx, r.INSERT(r.ID, r.DictionaryID, r.CardID, r.Rating, r.Direction, r.PreviousSchedule, r.ResultingRevision, r.ReviewedAt).
		VALUES(jetUUID(input.ID), jetUUID(dictionaryID), jetUUID(cardID), input.Rating, input.Direction, lingvoJSON(card.Schedule), card.Revision+1, now)); err != nil {
		if isUniqueViolation(err) {
			return result, lingvo.ErrConflict
		}
		return result, err
	}
	c := table.LingvoCards
	if _, err := jetExec(ctx, tx, c.UPDATE(c.Schedule, c.DueAt, c.Revision, c.UpdatedAt).
		SET(lingvoJSON(schedule), schedule.Due, card.Revision+1, now).
		WHERE(jetpg.AND(c.ID.EQ(jetUUID(cardID)), c.DictionaryID.EQ(jetUUID(dictionaryID))))); err != nil {
		return result, err
	}
	result.Card.Schedule = schedule
	result.Card.Revision++
	return result, tx.Commit(ctx)
}

func (s *Lingvo) Undo(ctx context.Context, actorID, dictionaryID, reviewID string) (lingvo.Card, error) {
	tx, _, err := s.beginDictionary(ctx, actorID, dictionaryID)
	if err != nil {
		return lingvo.Card{}, err
	}
	defer tx.Rollback(ctx)
	r := table.LingvoReviews
	var cardID *string
	var revision int64
	var previous []byte
	var reviewedAt time.Time
	var undone *time.Time
	err = jetQueryRow(ctx, tx, r.SELECT(r.CardID, r.ResultingRevision, r.PreviousSchedule, r.ReviewedAt, r.UndoneAt).
		WHERE(jetpg.AND(r.ID.EQ(jetUUID(reviewID)), r.DictionaryID.EQ(jetUUID(dictionaryID))))).
		Scan(&cardID, &revision, &previous, &reviewedAt, &undone)
	if errors.Is(err, pgx.ErrNoRows) {
		return lingvo.Card{}, lingvo.ErrNotFound
	}
	if err != nil {
		return lingvo.Card{}, err
	}
	if cardID == nil {
		return lingvo.Card{}, lingvo.ErrNotFound
	}
	card, err := getLingvoCard(ctx, tx, dictionaryID, *cardID)
	if err != nil {
		return card, err
	}
	if undone != nil {
		if card.Revision != revision+1 {
			return card, lingvo.ErrConflict
		}
		return card, tx.Commit(ctx)
	}
	if card.Revision != revision || time.Since(reviewedAt) > 10*time.Minute {
		return card, lingvo.ErrConflict
	}
	var schedule lingvo.Schedule
	if err := json.Unmarshal(previous, &schedule); err != nil {
		return card, err
	}
	now := time.Now().UTC()
	c := table.LingvoCards
	if _, err := jetExec(ctx, tx, c.UPDATE(c.Schedule, c.DueAt, c.Revision, c.UpdatedAt).
		SET(lingvoJSON(schedule), schedule.Due, revision+1, now).
		WHERE(jetpg.AND(c.ID.EQ(jetUUID(*cardID)), c.DictionaryID.EQ(jetUUID(dictionaryID))))); err != nil {
		return card, err
	}
	if _, err := jetExec(ctx, tx, r.UPDATE(r.UndoneAt).SET(now).
		WHERE(jetpg.AND(r.ID.EQ(jetUUID(reviewID)), r.DictionaryID.EQ(jetUUID(dictionaryID))))); err != nil {
		return card, err
	}
	card.Schedule = schedule
	card.Revision++
	return card, tx.Commit(ctx)
}
