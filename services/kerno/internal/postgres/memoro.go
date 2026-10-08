package postgres

// Reads encrypted diary summaries and serializes revision-checked day writes with media ownership
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/memoro"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Memoro struct{ pool *pgxpool.Pool }

func NewMemoro(pool *pgxpool.Pool) *Memoro { return &Memoro{pool: pool} }
func (s *Memoro) Month(ctx context.Context, actorID, monthTag string) ([]memoro.Summary, error) {
	if !memoro.ValidTag(monthTag) {
		return nil, memoro.ErrInvalid
	}
	d := table.MemoroDays
	rows, err := jetQuery(ctx, s.pool, d.SELECT(d.DayTag, d.MonthTag, d.Revision, d.SummaryNonce, d.SummaryCiphertext).
		WHERE(jetpg.AND(d.UserID.EQ(jetUUID(actorID)), d.MonthTag.EQ(jetpg.String(monthTag)))).LIMIT(32))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]memoro.Summary, 0)
	for rows.Next() {
		var item memoro.Summary
		if err := rows.Scan(&item.DayTag, &item.MonthTag, &item.Revision, &item.Nonce, &item.Ciphertext); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func memoroDay(ctx context.Context, executor jetExecutor, actorID, dayTag string) (*memoro.Day, error) {
	d := table.MemoroDays
	item := &memoro.Day{Media: make([]memoro.Media, 0)}
	err := jetQueryRow(ctx, executor, d.SELECT(d.DayTag, d.MonthTag, d.Revision, d.Nonce, d.Ciphertext).
		WHERE(jetpg.AND(d.UserID.EQ(jetUUID(actorID)), d.DayTag.EQ(jetpg.String(dayTag))))).
		Scan(&item.DayTag, &item.MonthTag, &item.Revision, &item.Nonce, &item.Ciphertext)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	m := table.MemoroDayMedia
	rows, err := jetQuery(ctx, executor, m.SELECT(m.UploadID, m.SizeBytes).
		WHERE(jetpg.AND(m.UserID.EQ(jetUUID(actorID)), m.DayTag.EQ(jetpg.String(dayTag)))))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var media memoro.Media
		if err := rows.Scan(&media.ID, &media.Size); err != nil {
			return nil, err
		}
		item.Media = append(item.Media, media)
	}
	return item, rows.Err()
}
func (s *Memoro) Day(ctx context.Context, actorID, dayTag string) (*memoro.Day, error) {
	if !memoro.ValidTag(dayTag) {
		return nil, memoro.ErrInvalid
	}
	return memoroDay(ctx, s.pool, actorID, dayTag)
}
func (s *Memoro) SaveDay(ctx context.Context, actorID, dayTag string, input memoro.DayUpdate, media []memoro.Media) (memoro.Day, error) {
	if err := input.Validate(); err != nil {
		return memoro.Day{}, err
	}
	if !memoro.ValidTag(dayTag) || len(media) != len(input.AttachmentIDs) {
		return memoro.Day{}, memoro.ErrInvalid
	}
	for i, item := range media {
		if item.ID != input.AttachmentIDs[i] || item.Size < 17 || item.Size > 104857600 {
			return memoro.Day{}, memoro.ErrInvalid
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return memoro.Day{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockEncryptionOwner(ctx, tx, actorID); err != nil {
		return memoro.Day{}, err
	}
	previous, err := memoroDay(ctx, tx, actorID, dayTag)
	if err != nil {
		return memoro.Day{}, err
	}
	if (previous == nil && input.Revision != 0) || (previous != nil && (previous.Revision != input.Revision || previous.MonthTag != input.MonthTag)) {
		return memoro.Day{}, memoro.ErrConflict
	}
	d := table.MemoroDays
	if previous == nil {
		var count int
		if err := jetQueryRow(ctx, tx, d.SELECT(jetpg.COUNT(d.DayTag)).WHERE(jetpg.AND(d.UserID.EQ(jetUUID(actorID)), d.MonthTag.EQ(jetpg.String(input.MonthTag))))).Scan(&count); err != nil {
			return memoro.Day{}, err
		}
		if count >= 31 {
			return memoro.Day{}, memoro.ErrLimit
		}
		if _, err := jetExec(ctx, tx, d.INSERT(d.UserID, d.DayTag, d.MonthTag, d.Nonce, d.Ciphertext, d.SummaryNonce, d.SummaryCiphertext).
			VALUES(jetUUID(actorID), jetpg.String(dayTag), jetpg.String(input.MonthTag), jetpg.String(input.Nonce), jetpg.String(input.Ciphertext), jetpg.String(input.Summary.Nonce), jetpg.String(input.Summary.Ciphertext))); err != nil {
			return memoro.Day{}, err
		}
	} else {
		if _, err := jetExec(ctx, tx, d.UPDATE().SET(d.Nonce.SET(jetpg.String(input.Nonce)), d.Ciphertext.SET(jetpg.String(input.Ciphertext)),
			d.SummaryNonce.SET(jetpg.String(input.Summary.Nonce)), d.SummaryCiphertext.SET(jetpg.String(input.Summary.Ciphertext)),
			d.Revision.SET(d.Revision.ADD(jetpg.Int(1))), d.UpdatedAt.SET(jetpg.RawTimestampz("now()"))).
			WHERE(jetpg.AND(d.UserID.EQ(jetUUID(actorID)), d.DayTag.EQ(jetpg.String(dayTag))))); err != nil {
			return memoro.Day{}, err
		}
	}
	claimed, err := claimUploads(ctx, tx, actorID, input.AttachmentIDs)
	if err != nil {
		return memoro.Day{}, err
	}
	if !claimed {
		return memoro.Day{}, memoro.ErrMedia
	}
	m := table.MemoroDayMedia
	if _, err := jetExec(ctx, tx, m.DELETE().WHERE(jetpg.AND(m.UserID.EQ(jetUUID(actorID)), m.DayTag.EQ(jetpg.String(dayTag))))); err != nil {
		return memoro.Day{}, err
	}
	for _, item := range media {
		if _, err := jetExec(ctx, tx, m.INSERT(m.UserID, m.DayTag, m.UploadID, m.SizeBytes).
			VALUES(jetUUID(actorID), jetpg.String(dayTag), jetUUID(item.ID), jetpg.Int(item.Size))); err != nil {
			return memoro.Day{}, err
		}
	}
	if previous != nil {
		for _, item := range previous.Media {
			if _, err := retireUnreferencedUpload(ctx, tx, item.ID); err != nil {
				return memoro.Day{}, err
			}
		}
	}
	result := memoro.Day{DayTag: dayTag, MonthTag: input.MonthTag, Revision: input.Revision + 1, Envelope: input.Envelope, Media: media}
	return result, tx.Commit(ctx)
}

var _ memoro.Store = (*Memoro)(nil)
