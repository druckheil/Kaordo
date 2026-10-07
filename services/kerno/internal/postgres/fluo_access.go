package postgres

// Shares post and account access checks across Fluo posts, counts and reply lineages
import (
	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
)

func postTreeAccessible(viewerID string, post *table.FluoPostsTable) jetpg.BoolExpression {
	lineage := table.FluoPosts.AS("lineage")
	return jetpg.BoolExp(jetpg.CustomExpression(jetpg.Token(`NOT EXISTS (
		WITH RECURSIVE lineage AS (
			SELECT id, parent_id, visibility, author_id FROM fluo_posts WHERE id =`), post.ID, jetpg.Token(`
			UNION ALL
			SELECT parent.id, parent.parent_id, parent.visibility, parent.author_id
			FROM fluo_posts parent JOIN lineage child ON parent.id = child.parent_id
		)
		SELECT 1 FROM lineage WHERE`), jetpg.NOT(postDirectlyAccessible(viewerID, lineage)), jetpg.Token(`)`)))
}

func postDirectlyAccessible(viewerID string, posts *table.FluoPostsTable) jetpg.BoolExpression {
	settings := table.FluoSettings.AS("author_preferences")
	follows := table.FluoFollows.AS("allowed_audience")
	publicAccount := jetpg.NOT(jetpg.EXISTS(jetpg.SELECT(settings.UserID).FROM(settings).WHERE(jetpg.AND(
		settings.UserID.EQ(posts.AuthorID), settings.AccountVisibility.EQ(jetpg.String(fluo.VisibilityPrivate)),
	))))
	allowedAudience := jetpg.EXISTS(jetpg.SELECT(follows.FollowedID).FROM(follows).WHERE(jetpg.AND(
		follows.FollowerID.EQ(posts.AuthorID), follows.FollowedID.EQ(jetUUID(viewerID)),
	)))
	return jetpg.OR(
		posts.AuthorID.EQ(jetUUID(viewerID)),
		jetpg.AND(
			posts.Visibility.EQ(jetpg.String(fluo.VisibilityPublic)),
			jetpg.OR(publicAccount, allowedAudience),
		),
	)
}

func postAccessibleCondition(viewerID string, posts *table.FluoPostsTable) jetpg.BoolExpression {
	// Reject individual private posts cheaply before walking the complete ancestor policy.
	return jetpg.AND(
		jetpg.OR(posts.Visibility.EQ(jetpg.String(fluo.VisibilityPublic)), posts.AuthorID.EQ(jetUUID(viewerID))),
		postTreeAccessible(viewerID, posts),
	)
}
