package postgres

// Creates and deletes Fluo posts with atomic media claims
import (
	"context"
	"errors"
	"fmt"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func (store *Fluo) Create(ctx context.Context, actorID string, input fluo.NewPost, text string, media []fluo.Media) (fluo.Post, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return fluo.Post{}, err
	}
	defer tx.Rollback(ctx)

	if err := enforcePostRateLimit(ctx, tx, actorID); err != nil {
		return fluo.Post{}, err
	}
	visibility, err := resolvePostVisibility(ctx, tx, actorID, input)
	if err != nil {
		return fluo.Post{}, err
	}
	id, err := insertPost(ctx, tx, actorID, input, text, visibility)
	if err != nil {
		return fluo.Post{}, err
	}
	if err := claimPostMedia(ctx, tx, actorID, media); err != nil {
		return fluo.Post{}, err
	}
	if err := attachPostMedia(ctx, tx, id, media); err != nil {
		return fluo.Post{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return fluo.Post{}, err
	}
	return store.Get(ctx, actorID, id)
}

func enforcePostRateLimit(ctx context.Context, tx pgx.Tx, actorID string) error {
	if err := jetAdvisoryLock(ctx, tx, jetpg.RawString("pg_advisory_xact_lock(hashtext(#actor))", jetpg.RawArgs{"#actor": actorID})); err != nil {
		return err
	}
	posts := table.FluoPosts
	var recent int
	err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(posts.ID)).FROM(posts).WHERE(jetpg.AND(
		posts.AuthorID.EQ(jetUUID(actorID)), posts.CreatedAt.GT(jetpg.RawTimestampz("now() - interval '1 minute'")),
	))).Scan(&recent)
	if err != nil {
		return err
	}
	if recent >= 30 {
		return fluo.ErrRateLimited
	}
	return nil
}

func resolvePostVisibility(ctx context.Context, tx pgx.Tx, actorID string, input fluo.NewPost) (string, error) {
	visibility := input.Visibility
	referenceID := input.QuoteID
	if input.ParentID != nil {
		referenceID = input.ParentID
	}
	if referenceID == nil {
		return visibility, nil
	}

	reference := table.FluoPosts
	var referenceVisibility, referenceAuthor string
	err := jetQueryRow(ctx, tx, reference.SELECT(reference.Visibility, jetpg.CAST(reference.AuthorID).AS_TEXT()).
		WHERE(jetpg.AND(reference.ID.EQ(jetUUID(*referenceID)), reference.ParentID.IS_NULL())).
		FOR(jetpg.SHARE())).Scan(&referenceVisibility, &referenceAuthor)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fluo.ErrInvalidRelation
	}
	if err != nil {
		return "", err
	}

	if input.ParentID != nil {
		if referenceVisibility != "public" && referenceAuthor != actorID {
			return "", fluo.ErrInvalidRelation
		}
		return referenceVisibility, nil
	}
	if referenceVisibility != "public" {
		return "", fluo.ErrInvalidRelation
	}
	return visibility, nil
}

func insertPost(ctx context.Context, tx pgx.Tx, actorID string, input fluo.NewPost, text, visibility string) (string, error) {
	posts := table.FluoPosts
	var id string
	err := jetQueryRow(ctx, tx, posts.INSERT(posts.AuthorID, posts.Content, posts.PlainText, posts.Visibility, posts.ParentID, posts.QuoteID).
		VALUES(jetUUID(actorID), jetpg.Json([]byte(input.Content)), jetpg.String(text), jetpg.String(visibility),
			nullableUUID(input.ParentID), nullableUUID(input.QuoteID)).
		RETURNING(jetpg.CAST(posts.ID).AS_TEXT())).Scan(&id)
	return id, err
}

func claimPostMedia(ctx context.Context, tx pgx.Tx, actorID string, media []fluo.Media) error {
	ids := make([]string, len(media))
	for index, item := range media {
		ids[index] = item.ID
	}
	claimed, err := claimUploads(ctx, tx, actorID, ids)
	if err != nil {
		return err
	}
	if !claimed {
		return fluo.ErrMediaOwner
	}
	return nil
}

func attachPostMedia(ctx context.Context, tx pgx.Tx, postID string, media []fluo.Media) error {
	postMedia := table.FluoPostMedia
	for position, item := range media {
		_, err := jetExec(ctx, tx, postMedia.INSERT(postMedia.PostID, postMedia.UploadID, postMedia.Position,
			postMedia.Kind, postMedia.MimeType, postMedia.Width, postMedia.Height, postMedia.SizeBytes, postMedia.AltText).
			VALUES(jetUUID(postID), jetUUID(item.ID), jetpg.Int(int64(position)), jetpg.String(item.Kind),
				jetpg.String(item.MimeType), jetpg.Int(int64(item.Width)), jetpg.Int(int64(item.Height)),
				jetpg.Int(int64(item.Size)), jetpg.String(item.AltText)))
		if err != nil {
			return err
		}
	}
	return nil
}

func (store *Fluo) Delete(ctx context.Context, actorID, id string) ([]string, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if err := lockOwnedPost(ctx, tx, actorID, id); err != nil {
		return nil, err
	}
	mediaIDs, err := postMediaIDs(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if err := lockPostMediaClaims(ctx, tx, mediaIDs); err != nil {
		return nil, err
	}
	if err := deletePostRecord(ctx, tx, id); err != nil {
		return nil, err
	}
	retiredIDs, err := retirePostMediaClaims(ctx, tx, mediaIDs)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return retiredIDs, nil
}

func lockOwnedPost(ctx context.Context, tx pgx.Tx, actorID, postID string) error {
	posts := table.FluoPosts
	var lockedID string
	err := jetQueryRow(ctx, tx, posts.SELECT(jetpg.CAST(posts.ID).AS_TEXT()).
		WHERE(jetpg.AND(posts.ID.EQ(jetUUID(postID)), posts.AuthorID.EQ(jetUUID(actorID)))).
		FOR(jetpg.UPDATE())).Scan(&lockedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fluo.ErrNotFound
	}
	return err
}

func postMediaIDs(ctx context.Context, tx pgx.Tx, postID string) ([]string, error) {
	postMedia := table.FluoPostMedia.AS("pm")
	children := table.FluoPosts.AS("children")
	uploadIDText := jetpg.CAST(postMedia.UploadID).AS_TEXT()
	query := postMedia.SELECT(uploadIDText).DISTINCT().WHERE(jetpg.OR(
		postMedia.PostID.EQ(jetUUID(postID)),
		jetpg.EXISTS(jetpg.SELECT(children.ID).FROM(children).WHERE(jetpg.AND(
			children.ID.EQ(postMedia.PostID), children.ParentID.EQ(jetUUID(postID)),
		))),
	)).ORDER_BY(uploadIDText.ASC())
	rows, err := jetQuery(ctx, tx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := make([]string, 0)
	for rows.Next() {
		var uploadID string
		if err := rows.Scan(&uploadID); err != nil {
			return nil, err
		}
		ids = append(ids, uploadID)
	}
	return ids, rows.Err()
}

func lockPostMediaClaims(ctx context.Context, tx pgx.Tx, mediaIDs []string) error {
	claims := table.NodoUploadClaims
	for _, mediaID := range mediaIDs {
		var lockedID string
		if err := jetQueryRow(ctx, tx, claims.SELECT(jetpg.CAST(claims.UploadID).AS_TEXT()).
			WHERE(claims.UploadID.EQ(jetUUID(mediaID))).FOR(jetpg.UPDATE())).Scan(&lockedID); err != nil {
			return fmt.Errorf("lock media claim %s: %w", mediaID, err)
		}
	}
	return nil
}

func deletePostRecord(ctx context.Context, tx pgx.Tx, postID string) error {
	posts := table.FluoPosts
	_, err := jetExec(ctx, tx, posts.DELETE().WHERE(posts.ID.EQ(jetUUID(postID))))
	return err
}

func retirePostMediaClaims(ctx context.Context, tx pgx.Tx, mediaIDs []string) ([]string, error) {
	retiredIDs := make([]string, 0, len(mediaIDs))
	for _, mediaID := range mediaIDs {
		retired, err := retireUnreferencedUpload(ctx, tx, mediaID)
		if err != nil {
			return nil, err
		}
		if retired {
			retiredIDs = append(retiredIDs, mediaID)
		}
	}
	return retiredIDs, nil
}
