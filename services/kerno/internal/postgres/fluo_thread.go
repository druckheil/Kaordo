package postgres

// Loads an accessible Fluo thread from its root through the selected post
import (
	"context"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func (store *Fluo) Thread(ctx context.Context, viewerID, postID string) (fluo.Thread, error) {
	tx, err := store.pool.BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		return fluo.Thread{}, err
	}
	defer tx.Rollback(ctx)

	postIDs, err := threadPostIDs(ctx, tx, postID)
	if err != nil {
		return fluo.Thread{}, err
	}
	posts := table.FluoPosts.AS("p")
	rows, err := jetQuery(ctx, tx, postQuery(viewerID).WHERE(jetpg.AND(
		posts.ID.IN(jetUUIDList(postIDs)...),
		postAccessibleCondition(viewerID, posts),
	)))
	if err != nil {
		return fluo.Thread{}, err
	}
	defer rows.Close()

	postsByID := make(map[string]fluo.Post, len(postIDs))
	for rows.Next() {
		post, err := scanPost(rows)
		if err != nil {
			return fluo.Thread{}, err
		}
		postsByID[post.ID] = post
	}
	if err := rows.Err(); err != nil {
		return fluo.Thread{}, err
	}
	if len(postsByID) != len(postIDs) {
		return fluo.Thread{}, fluo.ErrNotFound
	}

	thread := fluo.Thread{Posts: make([]fluo.Post, 0, len(postIDs))}
	for _, id := range postIDs {
		thread.Posts = append(thread.Posts, postsByID[id])
	}
	if err := tx.Commit(ctx); err != nil {
		return fluo.Thread{}, err
	}
	return thread, nil
}

func threadPostIDs(ctx context.Context, tx pgx.Tx, postID string) ([]string, error) {
	rows, err := jetQuery(ctx, tx, jetpg.RawStatement(`
		WITH RECURSIVE lineage(id, parent_id, depth) AS (
			SELECT id, parent_id, 0
			FROM fluo_posts
			WHERE id = #post::uuid
			UNION ALL
			SELECT parent.id, parent.parent_id, child.depth + 1
			FROM fluo_posts parent JOIN lineage child ON parent.id = child.parent_id
		)
		SELECT id::text
		FROM lineage
		ORDER BY depth DESC
	`, jetpg.RawArgs{"#post": postID}))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, fluo.ErrNotFound
	}
	return ids, nil
}
