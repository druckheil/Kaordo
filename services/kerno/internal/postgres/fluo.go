package postgres

// Reads Fluo posts and builds viewer-specific feed queries
import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Fluo struct {
	pool *pgxpool.Pool
}

func NewFluo(pool *pgxpool.Pool) *Fluo {
	return &Fluo{pool: pool}
}

func postQuery(viewerID string) jetpg.SelectStatement {
	p := table.FluoPosts.AS("p")
	a := table.Users.AS("a")
	q := table.FluoPosts.AS("q")
	qa := table.Users.AS("qa")
	saved := table.FluoSavedPosts.AS("s")
	reaction := table.FluoReactions.AS("r")
	good := table.FluoReactions.AS("good")
	bad := table.FluoReactions.AS("bad")
	comments := table.FluoPosts.AS("comments")
	quotes := table.FluoPosts.AS("quotes")
	saves := table.FluoSavedPosts.AS("saves")
	viewer := jetUUID(viewerID)
	return jetpg.SELECT(
		jetpg.CAST(p.ID).AS_TEXT(), fluoAuthorColumns(viewerID, a),
		p.Content, p.PlainText, p.Visibility, jetpg.CAST(p.ParentID).AS_TEXT(), jetpg.CAST(p.QuoteID).AS_TEXT(),
		p.QuoteDeleted,
		jetpg.CAST(q.ID).AS_TEXT(), jetpg.CAST(qa.ID).AS_TEXT(), qa.Username, fluoDisplayName(qa),
		fluoImageJSON(qa.ID, "avatar"), fluoVerified(qa), q.PlainText, postMediaJSON(q),
		jetpg.IntExp(jetpg.SELECT(jetpg.COUNT(good.PostID)).FROM(good).
			WHERE(jetpg.AND(good.PostID.EQ(p.ID), good.Value.EQ(jetpg.String("good"))))),
		jetpg.IntExp(jetpg.SELECT(jetpg.COUNT(bad.PostID)).FROM(bad).
			WHERE(jetpg.AND(bad.PostID.EQ(p.ID), bad.Value.EQ(jetpg.String("bad"))))),
		jetpg.IntExp(jetpg.SELECT(jetpg.COUNT(comments.ID)).FROM(comments).WHERE(jetpg.AND(
			comments.ParentID.EQ(p.ID),
			// The selected parent is already accessible; only the direct child's policy can add a restriction.
			postDirectlyAccessible(viewerID, comments),
		))),
		jetpg.IntExp(jetpg.SELECT(jetpg.COUNT(quotes.ID)).FROM(quotes).WHERE(jetpg.AND(
			quotes.QuoteID.EQ(p.ID), quotes.Visibility.EQ(jetpg.String(fluo.VisibilityPublic)),
			// Quotes are roots by the post-kind constraint, so no ancestor walk is needed for counting.
			postDirectlyAccessible(viewerID, quotes),
		))),
		jetpg.IntExp(jetpg.SELECT(jetpg.COUNT(saves.PostID)).FROM(saves).WHERE(saves.PostID.EQ(p.ID))),
		jetpg.SELECT(reaction.Value).FROM(reaction).WHERE(jetpg.AND(reaction.PostID.EQ(p.ID), reaction.UserID.EQ(viewer))),
		jetpg.EXISTS(jetpg.SELECT(saved.PostID).FROM(saved).
			WHERE(jetpg.AND(saved.UserID.EQ(viewer), saved.PostID.EQ(p.ID)))),
		postMediaJSON(p), p.CreatedAt, p.UpdatedAt,
	).FROM(p.INNER_JOIN(a, a.ID.EQ(p.AuthorID)).
		LEFT_JOIN(q, jetpg.AND(
			q.ID.EQ(p.QuoteID), q.Visibility.EQ(jetpg.String(fluo.VisibilityPublic)),
			postTreeAccessible(viewerID, q),
		)).
		LEFT_JOIN(qa, qa.ID.EQ(q.AuthorID)))
}

func postMediaJSON(post *table.FluoPostsTable) jetpg.StringExpression {
	return jetpg.StringExp(jetpg.CustomExpression(jetpg.Token(`COALESCE((SELECT jsonb_agg(jsonb_build_object(
		'id', pm.upload_id::text, 'kind', pm.kind, 'mimeType', pm.mime_type,
		'width', pm.width, 'height', pm.height, 'size', pm.size_bytes, 'altText', pm.alt_text
	) ORDER BY pm.position) FROM fluo_post_media pm WHERE pm.post_id =`), post.ID, jetpg.Token(`), '[]'::jsonb)`)))
}

type scanner interface{ Scan(...any) error }

func scanPost(row scanner) (fluo.Post, error) {
	var post fluo.Post
	var parent, quote, quotePreviewID, quoteAuthorID, quoteUsername, quoteName, quoteText, reaction sql.NullString
	var mediaJSON, quoteMediaJSON, avatarJSON, quoteAvatarJSON []byte
	var quoteVerified bool
	err := row.Scan(
		&post.ID, &post.Author.ID, &post.Author.Username, &post.Author.DisplayName, &post.Author.Following,
		&avatarJSON, &post.Author.Verified,
		&post.Content, &post.Text, &post.Visibility, &parent, &quote, &post.QuoteDeleted,
		&quotePreviewID, &quoteAuthorID, &quoteUsername, &quoteName, &quoteAvatarJSON, &quoteVerified, &quoteText, &quoteMediaJSON,
		&post.Counts.Good, &post.Counts.Bad, &post.Counts.Comments, &post.Counts.Quotes, &post.Counts.Saves,
		&reaction, &post.Saved,
		&mediaJSON, &post.CreatedAt, &post.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return fluo.Post{}, fluo.ErrNotFound
	}
	if err != nil {
		return post, err
	}
	if err := json.Unmarshal(avatarJSON, &post.Author.Avatar); err != nil {
		return post, err
	}
	if parent.Valid {
		post.ParentID = &parent.String
	}
	if quote.Valid {
		post.QuoteID = &quote.String
	}
	if quotePreviewID.Valid {
		post.Quote = &fluo.Quote{
			ID: quotePreviewID.String,
			Author: fluo.Author{
				ID: quoteAuthorID.String, Username: quoteUsername.String, DisplayName: quoteName.String,
				Verified: quoteVerified,
			},
			Text: quoteText.String,
		}
		if err := json.Unmarshal(quoteAvatarJSON, &post.Quote.Author.Avatar); err != nil {
			return post, err
		}
		if err := json.Unmarshal(quoteMediaJSON, &post.Quote.Media); err != nil {
			return post, fmt.Errorf("decode quoted post media: %w", err)
		}
	}
	if reaction.Valid {
		post.MyReaction = &reaction.String
	}
	if err := json.Unmarshal(mediaJSON, &post.Media); err != nil {
		return post, fmt.Errorf("decode post media: %w", err)
	}
	return post, nil
}

func (store *Fluo) Get(ctx context.Context, viewerID, id string) (fluo.Post, error) {
	p := table.FluoPosts.AS("p")
	condition := jetpg.AND(p.ID.EQ(jetUUID(id)), postAccessibleCondition(viewerID, p))
	return scanPost(jetQueryRow(ctx, store.pool, postQuery(viewerID).WHERE(condition)))
}

func (store *Fluo) List(ctx context.Context, options fluo.ListOptions) (fluo.Page, error) {
	if err := validatePostParent(ctx, store, options); err != nil {
		return fluo.Page{}, err
	}

	posts := table.FluoPosts.AS("p")
	condition := postListCondition(options, posts)
	rows, err := jetQuery(ctx, store.pool, postQuery(options.ViewerID).WHERE(condition).
		ORDER_BY(posts.CreatedAt.DESC(), posts.ID.DESC()).LIMIT(int64(options.Limit+1)))
	if err != nil {
		return fluo.Page{}, err
	}
	defer rows.Close()
	return scanPostPage(rows, options.Limit)
}

func validatePostParent(ctx context.Context, store *Fluo, options fluo.ListOptions) error {
	if options.ParentID == nil {
		return nil
	}
	posts := table.FluoPosts.AS("p")
	var accessibleID string
	err := jetQueryRow(ctx, store.pool, posts.SELECT(jetpg.CAST(posts.ID).AS_TEXT()).WHERE(jetpg.AND(
		posts.ID.EQ(jetUUID(*options.ParentID)),
		postAccessibleCondition(options.ViewerID, posts),
	))).Scan(&accessibleID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fluo.ErrNotFound
	}
	return err
}

func postListCondition(options fluo.ListOptions, posts *table.FluoPostsTable) jetpg.BoolExpression {
	viewer := jetUUID(options.ViewerID)
	condition := postAccessibleCondition(options.ViewerID, posts)
	if options.AuthorID != nil {
		condition = jetpg.AND(condition, posts.AuthorID.EQ(jetUUID(*options.AuthorID)))
	}
	if options.ParentID == nil {
		if options.Feed != "saved" {
			condition = jetpg.AND(condition, posts.ParentID.IS_NULL())
		}
		condition = postFeedCondition(condition, options.Feed, posts, viewer)
	} else {
		condition = jetpg.AND(condition, posts.ParentID.EQ(jetUUID(*options.ParentID)))
	}
	if options.Cursor != nil {
		condition = jetpg.AND(condition, fluoBeforeCursor(posts.CreatedAt, posts.ID, *options.Cursor, false))
	}
	return condition
}

func fluoBeforeCursor(createdAt jetpg.TimestampzExpression, id jetpg.StringExpression, cursor fluo.Cursor, inclusive bool) jetpg.BoolExpression {
	beforeID := id.LT(jetUUID(cursor.ID))
	if inclusive {
		beforeID = id.LT_EQ(jetUUID(cursor.ID))
	}
	return jetpg.OR(
		createdAt.LT(jetpg.TimestampzT(cursor.CreatedAt)),
		jetpg.AND(createdAt.EQ(jetpg.TimestampzT(cursor.CreatedAt)), beforeID),
	)
}

func postFeedCondition(condition jetpg.BoolExpression, feed string, posts *table.FluoPostsTable, viewer jetpg.StringExpression) jetpg.BoolExpression {
	saved := table.FluoSavedPosts.AS("s")
	follows := table.FluoFollows.AS("f")
	switch feed {
	case "latest":
		return condition
	case "mine":
		return jetpg.AND(condition, posts.AuthorID.EQ(viewer))
	case "saved":
		return jetpg.AND(condition, jetpg.EXISTS(jetpg.SELECT(saved.PostID).FROM(saved).
			WHERE(jetpg.AND(saved.UserID.EQ(viewer), saved.PostID.EQ(posts.ID)))))
	case "following":
		return jetpg.AND(condition, jetpg.EXISTS(jetpg.SELECT(follows.FollowedID).
			FROM(follows).WHERE(jetpg.AND(follows.FollowerID.EQ(viewer), follows.FollowedID.EQ(posts.AuthorID)))))
	default:
		return jetpg.AND(condition, jetpg.Bool(false))
	}
}

func scanPostPage(rows pgx.Rows, limit int) (fluo.Page, error) {
	page := fluo.Page{Items: make([]fluo.Post, 0, limit)}
	for rows.Next() {
		post, err := scanPost(rows)
		if err != nil {
			return fluo.Page{}, err
		}
		page.Items = append(page.Items, post)
	}
	if err := rows.Err(); err != nil {
		return fluo.Page{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		last := page.Items[len(page.Items)-1]
		cursor := (fluo.Cursor{CreatedAt: last.CreatedAt, ID: last.ID}).Encode()
		page.NextCursor = &cursor
	}
	return page, nil
}
