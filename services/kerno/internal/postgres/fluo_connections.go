package postgres

// Reads follower counts and paginated account lists using the existing follow relation
import (
	"context"
	"encoding/json"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
)

func connectionColumns(follows *table.FluoFollowsTable, kind string) (owner, other jetpg.ColumnString) {
	if kind == "followers" {
		return follows.FollowedID, follows.FollowerID
	}
	return follows.FollowerID, follows.FollowedID
}

func fluoConnectionCount(userID jetpg.StringExpression, kind string) jetpg.IntegerExpression {
	follows := table.FluoFollows.AS("count_follow")
	user := table.Users.AS("count_user")
	owner, other := connectionColumns(follows, kind)
	return jetpg.IntExp(jetpg.SELECT(jetpg.COUNT(other)).FROM(follows.INNER_JOIN(user, user.ID.EQ(other))).
		WHERE(jetpg.AND(owner.EQ(userID), user.DisabledAt.IS_NULL())))
}

func (store *Fluo) Connections(ctx context.Context, options fluo.ConnectionOptions) (fluo.ConnectionPage, error) {
	user := table.Users.AS("connection_user")
	var exists bool
	err := jetQueryRow(ctx, store.pool, jetpg.SELECT(jetpg.EXISTS(
		user.SELECT(user.ID).WHERE(jetpg.AND(user.ID.EQ(jetUUID(options.UserID)), user.DisabledAt.IS_NULL())),
	))).Scan(&exists)
	if err != nil {
		return fluo.ConnectionPage{}, err
	}
	if !exists {
		return fluo.ConnectionPage{}, fluo.ErrNotFound
	}
	follows := table.FluoFollows.AS("connection_follow")
	owner, other := connectionColumns(follows, options.Kind)
	condition := jetpg.AND(owner.EQ(jetUUID(options.UserID)), user.DisabledAt.IS_NULL())
	if options.Cursor != nil {
		condition = jetpg.AND(condition, fluoBeforeCursor(follows.CreatedAt, other, *options.Cursor, false))
	}
	rows, err := jetQuery(ctx, store.pool, jetpg.SELECT(fluoAuthorColumns(options.ViewerID, user), follows.CreatedAt).
		FROM(follows.INNER_JOIN(user, user.ID.EQ(other))).WHERE(condition).
		ORDER_BY(follows.CreatedAt.DESC(), other.DESC()).LIMIT(int64(options.Limit+1)))
	if err != nil {
		return fluo.ConnectionPage{}, err
	}
	defer rows.Close()
	page := fluo.ConnectionPage{Items: make([]fluo.Author, 0, options.Limit)}
	var createdAt time.Time
	hasMore := false
	for rows.Next() {
		if len(page.Items) == options.Limit {
			hasMore = true
			break
		}
		var author fluo.Author
		var avatar []byte
		if err := rows.Scan(&author.ID, &author.Username, &author.DisplayName, &author.Following, &avatar, &author.Verified, &createdAt); err != nil {
			return fluo.ConnectionPage{}, err
		}
		if err := json.Unmarshal(avatar, &author.Avatar); err != nil {
			return fluo.ConnectionPage{}, err
		}
		page.Items = append(page.Items, author)
		cursor := (fluo.Cursor{CreatedAt: createdAt, ID: author.ID}).Encode()
		page.NextCursor = &cursor
	}
	if err := rows.Err(); err != nil {
		return fluo.ConnectionPage{}, err
	}
	// A cursor is needed only when the extra row proves another page exists.
	if !hasMore {
		page.NextCursor = nil
	}
	return page, nil
}
