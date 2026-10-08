package postgres

// Updates owned profile fields and retires replaced image claims in one transaction
import (
	"context"
	"errors"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func (store *Fluo) UpdateProfile(ctx context.Context, userID string, input fluo.ProfileUpdate, images []fluo.ProfileImage) (fluo.Profile, []string, error) {
	input.Normalize()
	if err := input.Validate(time.Now()); err != nil {
		return fluo.Profile{}, nil, err
	}
	if err := input.ValidateImages(images); err != nil {
		return fluo.Profile{}, nil, err
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return fluo.Profile{}, nil, err
	}
	defer tx.Rollback(ctx)
	user := table.Users
	var lockedID string
	// Serialize edits while allowing media claims to retain their user foreign-key locks.
	err = jetQueryRow(ctx, tx, user.SELECT(jetpg.CAST(user.ID).AS_TEXT()).WHERE(jetpg.AND(
		user.ID.EQ(jetUUID(userID)), user.DisabledAt.IS_NULL(),
	)).FOR(jetpg.NO_KEY_UPDATE())).Scan(&lockedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fluo.Profile{}, nil, fluo.ErrNotFound
	}
	if err != nil {
		return fluo.Profile{}, nil, err
	}
	retired, err := replaceFluoProfileImages(ctx, tx, userID, images)
	if err != nil {
		return fluo.Profile{}, nil, err
	}
	if err := writeFluoProfile(ctx, tx, userID, input); err != nil {
		return fluo.Profile{}, nil, err
	}
	saved, err := ownedFluoProfile(ctx, tx, userID)
	if err != nil {
		return fluo.Profile{}, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return fluo.Profile{}, nil, err
	}
	return saved, retired, nil
}

func writeFluoProfile(ctx context.Context, tx pgx.Tx, userID string, input fluo.ProfileUpdate) error {
	profile := table.FluoProfiles
	var birthday jetpg.Expression = jetpg.NULL
	if input.BirthDate != nil {
		date, _ := time.Parse(time.DateOnly, *input.BirthDate)
		birthday = jetpg.DateT(date)
	}
	_, err := jetExec(ctx, tx, profile.INSERT(
		profile.UserID, profile.Nickname, profile.Bio, profile.BirthDate, profile.Location, profile.Website, profile.Pronouns,
	).VALUES(jetUUID(userID), input.Nickname, input.Bio, birthday, input.Location, input.Website, input.Pronouns).
		ON_CONFLICT(profile.UserID).DO_UPDATE(jetpg.SET(
		profile.Nickname.SET(profile.EXCLUDED.Nickname), profile.Bio.SET(profile.EXCLUDED.Bio),
		profile.BirthDate.SET(profile.EXCLUDED.BirthDate), profile.Location.SET(profile.EXCLUDED.Location),
		profile.Website.SET(profile.EXCLUDED.Website), profile.Pronouns.SET(profile.EXCLUDED.Pronouns),
		profile.UpdatedAt.SET(jetpg.RawTimestampz("now()")),
	)))
	return err
}

func replaceFluoProfileImages(ctx context.Context, tx pgx.Tx, userID string, images []fluo.ProfileImage) ([]string, error) {
	target := table.FluoProfileImages
	rows, err := jetQuery(ctx, tx, target.SELECT(jetpg.CAST(target.UploadID).AS_TEXT()).WHERE(target.UserID.EQ(jetUUID(userID))))
	if err != nil {
		return nil, err
	}
	previous, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	// Lock both retained and replaced uploads in the shared claim order before retirement.
	ids := append([]string(nil), previous...)
	for _, image := range images {
		ids = append(ids, image.ID)
	}
	claimed, err := claimUploads(ctx, tx, userID, ids)
	if err != nil {
		return nil, err
	}
	if !claimed {
		return nil, fluo.ErrMediaOwner
	}
	if _, err := jetExec(ctx, tx, target.DELETE().WHERE(target.UserID.EQ(jetUUID(userID)))); err != nil {
		return nil, err
	}
	for _, image := range images {
		_, err := jetExec(ctx, tx, target.INSERT(target.UserID, target.Slot, target.UploadID, target.MimeType,
			target.Width, target.Height, target.SizeBytes).VALUES(
			jetUUID(userID), image.Slot, jetUUID(image.ID), image.MimeType, image.Width, image.Height, image.Size,
		))
		if err != nil {
			return nil, err
		}
	}
	retired := make([]string, 0, len(previous))
	for _, id := range previous {
		unused, err := retireUnreferencedUpload(ctx, tx, id)
		if err != nil {
			return nil, err
		}
		if unused {
			retired = append(retired, id)
		}
	}
	return retired, nil
}
