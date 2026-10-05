package postgres

// Updates Fluo post visibility and its direct replies atomically
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func (store *Fluo) SetVisibility(ctx context.Context, actorID, postID, visibility string) error {
	if !fluo.ValidVisibility(visibility) {
		return fluo.ErrInvalidVisibility
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := lockOwnedRootPost(ctx, tx, actorID, postID); err != nil {
		return err
	}
	if err := updatePostVisibility(ctx, tx, postID, visibility); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func lockOwnedRootPost(ctx context.Context, tx pgx.Tx, actorID, postID string) error {
	posts := table.FluoPosts
	var lockedID string
	err := jetQueryRow(ctx, tx, posts.SELECT(jetpg.CAST(posts.ID).AS_TEXT()).
		WHERE(jetpg.AND(posts.ID.EQ(jetUUID(postID)), posts.AuthorID.EQ(jetUUID(actorID)), posts.ParentID.IS_NULL())).
		FOR(jetpg.UPDATE())).Scan(&lockedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fluo.ErrNotFound
	}
	return err
}

func updatePostVisibility(ctx context.Context, tx pgx.Tx, postID, visibility string) error {
	posts := table.FluoPosts
	_, err := jetExec(ctx, tx, posts.UPDATE().SET(
		posts.Visibility.SET(jetpg.String(visibility)),
		posts.UpdatedAt.SET(jetpg.RawTimestampz("clock_timestamp()")),
	).WHERE(jetpg.OR(
		posts.ID.EQ(jetUUID(postID)),
		posts.ParentID.EQ(jetUUID(postID)),
	)))
	return err
}
