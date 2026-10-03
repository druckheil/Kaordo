package postgres

// Reads Fluo posts and builds viewer-specific feed queries
import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

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
	follows := table.FluoFollows.AS("f")
	saved := table.FluoSavedPosts.AS("s")
	reaction := table.FluoReactions.AS("r")
	good := table.FluoReactions.AS("good")
	bad := table.FluoReactions.AS("bad")
	comments := table.FluoPosts.AS("comments")
	quotedMedia := jetpg.RawString(`COALESCE((SELECT jsonb_agg(jsonb_build_object(
		'id', qm.upload_id::text, 'kind', qm.kind, 'mimeType', qm.mime_type,
		'width', qm.width, 'height', qm.height, 'size', qm.size_bytes, 'altText', qm.alt_text
	) ORDER BY qm.position) FROM fluo_post_media qm WHERE qm.post_id = q.id), '[]'::jsonb)`)
	media := jetpg.RawString(`COALESCE((SELECT jsonb_agg(jsonb_build_object(
		'id', pm.upload_id::text, 'kind', pm.kind, 'mimeType', pm.mime_type,
		'width', pm.width, 'height', pm.height, 'size', pm.size_bytes, 'altText', pm.alt_text
	) ORDER BY pm.position) FROM fluo_post_media pm WHERE pm.post_id = p.id), '[]'::jsonb)`)
	viewer := jetUUID(viewerID)
	return jetpg.SELECT(
		jetpg.CAST(p.ID).AS_TEXT(), jetpg.CAST(a.ID).AS_TEXT(), a.Username, a.DisplayName,
		jetpg.EXISTS(jetpg.SELECT(follows.FollowerID).FROM(follows).
			WHERE(jetpg.AND(follows.FollowerID.EQ(viewer), follows.FollowedID.EQ(a.ID)))),
		p.Content, p.PlainText, p.Visibility, jetpg.CAST(p.ParentID).AS_TEXT(), jetpg.CAST(p.QuoteID).AS_TEXT(),
		jetpg.CAST(q.ID).AS_TEXT(), jetpg.CAST(qa.ID).AS_TEXT(), qa.Username, qa.DisplayName, q.PlainText, quotedMedia,
		jetpg.IntExp(jetpg.SELECT(jetpg.COUNT(good.PostID)).FROM(good).
			WHERE(jetpg.AND(good.PostID.EQ(p.ID), good.Value.EQ(jetpg.String("good"))))),
		jetpg.IntExp(jetpg.SELECT(jetpg.COUNT(bad.PostID)).FROM(bad).
			WHERE(jetpg.AND(bad.PostID.EQ(p.ID), bad.Value.EQ(jetpg.String("bad"))))),
		jetpg.IntExp(jetpg.SELECT(jetpg.COUNT(comments.ID)).FROM(comments).WHERE(comments.ParentID.EQ(p.ID))),
		jetpg.SELECT(reaction.Value).FROM(reaction).WHERE(jetpg.AND(reaction.PostID.EQ(p.ID), reaction.UserID.EQ(viewer))),
		jetpg.EXISTS(jetpg.SELECT(saved.PostID).FROM(saved).
			WHERE(jetpg.AND(saved.UserID.EQ(viewer), saved.PostID.EQ(p.ID)))),
		media, p.CreatedAt, p.UpdatedAt,
	).FROM(p.INNER_JOIN(a, a.ID.EQ(p.AuthorID)).
		LEFT_JOIN(q, jetpg.AND(q.ID.EQ(p.QuoteID), q.ParentID.IS_NULL(), q.Visibility.EQ(jetpg.String("public")))).
		LEFT_JOIN(qa, qa.ID.EQ(q.AuthorID)))
}

type scanner interface{ Scan(...any) error }

func scanPost(row scanner) (fluo.Post, error) {
	var post fluo.Post
	var parent, quote, quotePreviewID, quoteAuthorID, quoteUsername, quoteName, quoteText, reaction sql.NullString
	var mediaJSON, quoteMediaJSON []byte
	err := row.Scan(
		&post.ID, &post.Author.ID, &post.Author.Username, &post.Author.DisplayName, &post.Author.Following,
		&post.Content, &post.Text, &post.Visibility, &parent, &quote,
		&quotePreviewID, &quoteAuthorID, &quoteUsername, &quoteName, &quoteText, &quoteMediaJSON,
		&post.Counts.Good, &post.Counts.Bad, &post.Counts.Comments, &reaction, &post.Saved,
		&mediaJSON, &post.CreatedAt, &post.UpdatedAt,
	)
	if err != nil {
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
			},
			Text: quoteText.String,
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
	root := table.FluoPosts.AS("root")
	viewer := jetUUID(viewerID)
	condition := jetpg.AND(p.ID.EQ(jetUUID(id)), jetpg.OR(p.Visibility.EQ(jetpg.String("public")), p.AuthorID.EQ(viewer)))
	rootVisible := jetpg.EXISTS(jetpg.SELECT(root.ID).FROM(root).WHERE(jetpg.AND(
		root.ID.EQ(p.ParentID), jetpg.OR(root.Visibility.EQ(jetpg.String("public")), root.AuthorID.EQ(viewer)),
	)))
	condition = jetpg.AND(condition, jetpg.OR(p.ParentID.IS_NULL(), rootVisible))
	post, err := scanPost(jetQueryRow(ctx, store.pool, postQuery(viewerID).WHERE(condition)))
	if errors.Is(err, pgx.ErrNoRows) {
		return fluo.Post{}, fluo.ErrNotFound
	}
	return post, err
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
	parent, err := store.Get(ctx, options.ViewerID, *options.ParentID)
	if err != nil {
		return err
	}
	if parent.ParentID != nil {
		return fluo.ErrNotFound
	}
	return nil
}

func postListCondition(options fluo.ListOptions, posts *table.FluoPostsTable) jetpg.BoolExpression {
	viewer := jetUUID(options.ViewerID)
	condition := jetpg.OR(posts.Visibility.EQ(jetpg.String("public")), posts.AuthorID.EQ(viewer))
	if options.ParentID == nil {
		condition = jetpg.AND(condition, posts.ParentID.IS_NULL())
		condition = postFeedCondition(condition, options.Feed, posts, viewer)
	} else {
		condition = jetpg.AND(condition, posts.ParentID.EQ(jetUUID(*options.ParentID)))
	}
	if options.Cursor != nil {
		condition = jetpg.AND(condition, jetpg.OR(
			posts.CreatedAt.LT(jetpg.TimestampzT(options.Cursor.CreatedAt)),
			jetpg.AND(posts.CreatedAt.EQ(jetpg.TimestampzT(options.Cursor.CreatedAt)), posts.ID.LT(jetUUID(options.Cursor.ID))),
		))
	}
	return postSearchCondition(condition, posts, options.Search)
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
		return jetpg.AND(condition, jetpg.OR(posts.AuthorID.EQ(viewer), jetpg.EXISTS(jetpg.SELECT(follows.FollowedID).
			FROM(follows).WHERE(jetpg.AND(follows.FollowerID.EQ(viewer), follows.FollowedID.EQ(posts.AuthorID))))))
	default:
		return jetpg.AND(condition, jetpg.Bool(false))
	}
}

func postSearchCondition(condition jetpg.BoolExpression, posts *table.FluoPostsTable, search string) jetpg.BoolExpression {
	search = strings.TrimSpace(search)
	if search == "" {
		return condition
	}
	pattern := jetpg.LOWER(jetpg.String("%" + escapeLikeLiteral(search) + "%"))
	author := table.Users.AS("a")
	return jetpg.AND(condition, jetpg.OR(
		jetpg.LOWER(posts.PlainText).LIKE(pattern),
		jetpg.EXISTS(jetpg.SELECT(author.ID).FROM(author).WHERE(jetpg.AND(
			author.ID.EQ(posts.AuthorID),
			jetpg.OR(jetpg.LOWER(author.Username).LIKE(pattern), jetpg.LOWER(author.DisplayName).LIKE(pattern)),
		))),
	))
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
		cursor := fluo.EncodeCursor(page.Items[len(page.Items)-1])
		page.NextCursor = &cursor
	}
	return page, nil
}
