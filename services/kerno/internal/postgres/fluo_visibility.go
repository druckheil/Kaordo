package postgres

// Updates a Fluo post and its reply branch visibility atomically
import (
	"context"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
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

	if err := lockPostThread(ctx, tx, postID); err != nil {
		return err
	}
	if err := lockOwnedPost(ctx, tx, actorID, postID); err != nil {
		return err
	}
	if visibility == fluo.VisibilityPublic {
		hasPrivateParent, err := postHasPrivateParent(ctx, tx, postID)
		if err != nil {
			return err
		}
		if hasPrivateParent {
			return fluo.ErrPrivateParent
		}
	}
	if err := updatePostVisibility(ctx, tx, postID, visibility); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func postHasPrivateParent(ctx context.Context, tx pgx.Tx, postID string) (bool, error) {
	var hasPrivateParent bool
	err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.RawBool(`EXISTS (
		WITH RECURSIVE lineage AS (
			SELECT parent.id, parent.parent_id, parent.visibility
			FROM fluo_posts current JOIN fluo_posts parent ON parent.id = current.parent_id
			WHERE current.id = #post::uuid
			UNION ALL
			SELECT parent.id, parent.parent_id, parent.visibility
			FROM fluo_posts parent JOIN lineage child ON parent.id = child.parent_id
		)
		SELECT 1 FROM lineage WHERE visibility = 'private'
	)`, jetpg.RawArgs{"#post": postID}))).Scan(&hasPrivateParent)
	return hasPrivateParent, err
}

func updatePostVisibility(ctx context.Context, tx pgx.Tx, postID, visibility string) error {
	_, err := jetExec(ctx, tx, jetpg.RawStatement(postBranchCTE+`
		UPDATE fluo_posts
		SET visibility = #visibility, updated_at = clock_timestamp()
		WHERE id IN (SELECT id FROM branch)
	`, jetpg.RawArgs{"#post": postID, "#visibility": visibility}))
	return err
}
