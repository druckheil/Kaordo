package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Fluo struct{ pool *pgxpool.Pool }

func NewFluo(pool *pgxpool.Pool) *Fluo { return &Fluo{pool: pool} }

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
	if options.ParentID != nil {
		parent, err := store.Get(ctx, options.ViewerID, *options.ParentID)
		if err != nil {
			return fluo.Page{}, err
		}
		if parent.ParentID != nil {
			return fluo.Page{}, fluo.ErrNotFound
		}
	}
	p := table.FluoPosts.AS("p")
	viewer := jetUUID(options.ViewerID)
	condition := jetpg.OR(p.Visibility.EQ(jetpg.String("public")), p.AuthorID.EQ(viewer))
	if options.ParentID == nil {
		condition = jetpg.AND(condition, p.ParentID.IS_NULL())
	} else {
		condition = jetpg.AND(condition, p.ParentID.EQ(jetUUID(*options.ParentID)))
	}
	if options.ParentID == nil {
		saved := table.FluoSavedPosts.AS("s")
		follows := table.FluoFollows.AS("f")
		switch options.Feed {
		case "latest":
		case "mine":
			condition = jetpg.AND(condition, p.AuthorID.EQ(viewer))
		case "saved":
			condition = jetpg.AND(condition, jetpg.EXISTS(jetpg.SELECT(saved.PostID).FROM(saved).
				WHERE(jetpg.AND(saved.UserID.EQ(viewer), saved.PostID.EQ(p.ID)))))
		case "following":
			condition = jetpg.AND(condition, jetpg.OR(p.AuthorID.EQ(viewer), jetpg.EXISTS(jetpg.SELECT(follows.FollowedID).
				FROM(follows).WHERE(jetpg.AND(follows.FollowerID.EQ(viewer), follows.FollowedID.EQ(p.AuthorID))))))
		default:
			condition = jetpg.AND(condition, jetpg.Bool(false))
		}
	}
	if options.Cursor != nil {
		condition = jetpg.AND(condition, jetpg.OR(
			p.CreatedAt.LT(jetpg.TimestampzT(options.Cursor.CreatedAt)),
			jetpg.AND(p.CreatedAt.EQ(jetpg.TimestampzT(options.Cursor.CreatedAt)), p.ID.LT(jetUUID(options.Cursor.ID))),
		))
	}
	if search := strings.TrimSpace(options.Search); search != "" {
		author := table.Users.AS("a")
		pattern := jetpg.String("%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search) + "%")
		condition = jetpg.AND(condition, jetpg.OR(
			jetpg.LOWER(p.PlainText).LIKE(pattern),
			jetpg.EXISTS(jetpg.SELECT(author.ID).FROM(author).WHERE(jetpg.AND(
				author.ID.EQ(p.AuthorID), jetpg.OR(jetpg.LOWER(author.Username).LIKE(pattern), jetpg.LOWER(author.DisplayName).LIKE(pattern)),
			))),
		))
	}
	rows, err := jetQuery(ctx, store.pool, postQuery(options.ViewerID).WHERE(condition).
		ORDER_BY(p.CreatedAt.DESC(), p.ID.DESC()).LIMIT(int64(options.Limit+1)))
	if err != nil {
		return fluo.Page{}, err
	}
	defer rows.Close()
	page := fluo.Page{Items: make([]fluo.Post, 0, options.Limit)}
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
	if len(page.Items) > options.Limit {
		page.Items = page.Items[:options.Limit]
		cursor := fluo.EncodeCursor(page.Items[len(page.Items)-1])
		page.NextCursor = &cursor
	}
	return page, nil
}

func (store *Fluo) Create(ctx context.Context, actorID string, input fluo.NewPost, text string, media []fluo.Media) (fluo.Post, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return fluo.Post{}, err
	}
	defer tx.Rollback(ctx)
	// Serializing each author's writes makes the per-minute limit effective under concurrency.
	if err := jetAdvisoryLock(ctx, tx, jetpg.RawString("pg_advisory_xact_lock(hashtext(#actor))", jetpg.RawArgs{"#actor": actorID})); err != nil {
		return fluo.Post{}, err
	}
	var recent int
	posts := table.FluoPosts
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(posts.ID)).FROM(posts).WHERE(jetpg.AND(
		posts.AuthorID.EQ(jetUUID(actorID)), posts.CreatedAt.GT(jetpg.RawTimestampz("now() - interval '1 minute'")),
	))).Scan(&recent); err != nil {
		return fluo.Post{}, err
	}
	if recent >= 30 {
		return fluo.Post{}, fluo.ErrRateLimited
	}
	visibility := input.Visibility
	if input.ParentID != nil || input.QuoteID != nil {
		referenceID := input.QuoteID
		if input.ParentID != nil {
			referenceID = input.ParentID
		}
		var referenceVisibility, referenceAuthor string
		reference := table.FluoPosts
		err := jetQueryRow(ctx, tx, reference.SELECT(reference.Visibility, jetpg.CAST(reference.AuthorID).AS_TEXT()).
			WHERE(jetpg.AND(reference.ID.EQ(jetUUID(*referenceID)), reference.ParentID.IS_NULL())).
			FOR(jetpg.SHARE())).Scan(&referenceVisibility, &referenceAuthor)
		if errors.Is(err, pgx.ErrNoRows) {
			return fluo.Post{}, fluo.ErrInvalidRelation
		}
		if err != nil {
			return fluo.Post{}, err
		}
		if input.ParentID != nil {
			if referenceVisibility != "public" && referenceAuthor != actorID {
				return fluo.Post{}, fluo.ErrInvalidRelation
			}
			visibility = referenceVisibility
		} else if referenceVisibility != "public" {
			return fluo.Post{}, fluo.ErrInvalidRelation
		}
	}
	var id string
	posts = table.FluoPosts
	err = jetQueryRow(ctx, tx, posts.INSERT(posts.AuthorID, posts.Content, posts.PlainText, posts.Visibility, posts.ParentID, posts.QuoteID).
		VALUES(jetUUID(actorID), jetpg.Json([]byte(input.Content)), jetpg.String(text), jetpg.String(visibility),
			nullableUUID(input.ParentID), nullableUUID(input.QuoteID)).
		RETURNING(jetpg.CAST(posts.ID).AS_TEXT())).Scan(&id)
	if err != nil {
		return fluo.Post{}, err
	}
	claims := append([]fluo.Media(nil), media...)
	sort.Slice(claims, func(i, j int) bool { return claims[i].ID < claims[j].ID })
	uploadClaims := table.NodoUploadClaims
	for _, item := range claims {
		claimed, err := jetExec(ctx, tx, uploadClaims.INSERT(uploadClaims.UploadID, uploadClaims.OwnerID).
			VALUES(jetUUID(item.ID), jetUUID(actorID)).
			ON_CONFLICT(uploadClaims.UploadID).DO_UPDATE(jetpg.SET(
			uploadClaims.OwnerID.SET(uploadClaims.EXCLUDED.OwnerID),
		).WHERE(jetpg.AND(uploadClaims.OwnerID.EQ(uploadClaims.EXCLUDED.OwnerID), uploadClaims.RetiredAt.IS_NULL()))))
		if err != nil {
			return fluo.Post{}, err
		}
		if claimed.RowsAffected() == 0 {
			return fluo.Post{}, fluo.ErrMediaOwner
		}
	}
	postMedia := table.FluoPostMedia
	for position, item := range media {
		_, err = jetExec(ctx, tx, postMedia.INSERT(postMedia.PostID, postMedia.UploadID, postMedia.Position,
			postMedia.Kind, postMedia.MimeType, postMedia.Width, postMedia.Height, postMedia.SizeBytes, postMedia.AltText).
			VALUES(jetUUID(id), jetUUID(item.ID), jetpg.Int(int64(position)), jetpg.String(item.Kind),
				jetpg.String(item.MimeType), jetpg.Int(int64(item.Width)), jetpg.Int(int64(item.Height)),
				jetpg.Int(int64(item.Size)), jetpg.String(item.AltText)))
		if err != nil {
			return fluo.Post{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fluo.Post{}, err
	}
	return store.Get(ctx, actorID, id)
}

func (store *Fluo) Delete(ctx context.Context, actorID, id string) ([]string, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var lockedID string
	posts := table.FluoPosts
	if err := jetQueryRow(ctx, tx, posts.SELECT(jetpg.CAST(posts.ID).AS_TEXT()).
		WHERE(jetpg.AND(posts.ID.EQ(jetUUID(id)), posts.AuthorID.EQ(jetUUID(actorID)))).
		FOR(jetpg.UPDATE())).Scan(&lockedID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fluo.ErrNotFound
		}
		return nil, err
	}
	postMedia := table.FluoPostMedia.AS("pm")
	children := table.FluoPosts.AS("children")
	uploadIDText := jetpg.CAST(postMedia.UploadID).AS_TEXT()
	rows, err := jetQuery(ctx, tx, postMedia.SELECT(uploadIDText).
		DISTINCT().WHERE(jetpg.OR(postMedia.PostID.EQ(jetUUID(id)),
		jetpg.EXISTS(jetpg.SELECT(children.ID).FROM(children).WHERE(jetpg.AND(
			children.ID.EQ(postMedia.PostID), children.ParentID.EQ(jetUUID(id)),
		))))).ORDER_BY(uploadIDText.ASC()))
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var uploadID string
		if err := rows.Scan(&uploadID); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, uploadID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	// Lock claims before removing references. A concurrent Create acquires the
	// same row through its upsert: it either commits a new reference first, or
	// observes the retired claim and fails before the bytes can be purged.
	uploadClaims := table.NodoUploadClaims
	for _, mediaID := range ids {
		var lockedID string
		if err := jetQueryRow(ctx, tx, uploadClaims.SELECT(jetpg.CAST(uploadClaims.UploadID).AS_TEXT()).
			WHERE(uploadClaims.UploadID.EQ(jetUUID(mediaID))).FOR(jetpg.UPDATE())).Scan(&lockedID); err != nil {
			return nil, fmt.Errorf("lock media claim %s: %w", mediaID, err)
		}
	}
	if _, err := jetExec(ctx, tx, posts.DELETE().WHERE(posts.ID.EQ(jetUUID(id)))); err != nil {
		return nil, err
	}
	retiredIDs := make([]string, 0, len(ids))
	for _, mediaID := range ids {
		claim := table.NodoUploadClaims.AS("claim")
		postMedia := table.FluoPostMedia.AS("post_media")
		messageMedia := table.LigoMessageMedia.AS("message_media")
		unused := jetpg.AND(
			jetpg.NOT(jetpg.EXISTS(jetpg.SELECT(postMedia.UploadID).FROM(postMedia).
				WHERE(postMedia.UploadID.EQ(claim.UploadID)))),
			jetpg.NOT(jetpg.EXISTS(jetpg.SELECT(messageMedia.UploadID).FROM(messageMedia).
				WHERE(messageMedia.UploadID.EQ(claim.UploadID)))),
		)
		result, err := jetExec(ctx, tx, claim.UPDATE().SET(claim.RetiredAt.SET(jetpg.RawTimestampz("now()"))).
			WHERE(jetpg.AND(claim.UploadID.EQ(jetUUID(mediaID)), claim.RetiredAt.IS_NULL(), unused)))
		if err != nil {
			return nil, err
		}
		if result.RowsAffected() > 0 {
			retiredIDs = append(retiredIDs, mediaID)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return retiredIDs, nil
}

func (store *Fluo) MediaReferenced(ctx context.Context, id string) (bool, error) {
	var referenced bool
	postMedia := table.FluoPostMedia
	messageMedia := table.LigoMessageMedia
	claims := table.NodoUploadClaims
	uploadID := jetUUID(id)
	err := jetQueryRow(ctx, store.pool, jetpg.SELECT(jetpg.OR(
		jetpg.EXISTS(jetpg.SELECT(postMedia.UploadID).FROM(postMedia).WHERE(postMedia.UploadID.EQ(uploadID))),
		jetpg.EXISTS(jetpg.SELECT(messageMedia.UploadID).FROM(messageMedia).WHERE(messageMedia.UploadID.EQ(uploadID))),
		jetpg.EXISTS(jetpg.SELECT(claims.UploadID).FROM(claims).WHERE(jetpg.AND(
			claims.UploadID.EQ(uploadID), claims.RetiredAt.IS_NULL(),
		))),
	))).Scan(&referenced)
	return referenced, err
}

func (store *Fluo) SetSaved(ctx context.Context, viewerID, postID string, saved bool) error {
	if _, err := store.Get(ctx, viewerID, postID); err != nil {
		return err
	}
	if saved {
		savedPosts := table.FluoSavedPosts
		_, err := jetExec(ctx, store.pool, savedPosts.INSERT(savedPosts.UserID, savedPosts.PostID).
			VALUES(jetUUID(viewerID), jetUUID(postID)).ON_CONFLICT(savedPosts.UserID, savedPosts.PostID).DO_NOTHING())
		return err
	}
	savedPosts := table.FluoSavedPosts
	_, err := jetExec(ctx, store.pool, savedPosts.DELETE().WHERE(jetpg.AND(
		savedPosts.UserID.EQ(jetUUID(viewerID)), savedPosts.PostID.EQ(jetUUID(postID)),
	)))
	return err
}

func (store *Fluo) React(ctx context.Context, actorID, postID string, value *string) (fluo.Post, error) {
	if _, err := store.Get(ctx, actorID, postID); err != nil {
		return fluo.Post{}, err
	}
	reactions := table.FluoReactions
	if value == nil {
		_, err := jetExec(ctx, store.pool, reactions.DELETE().WHERE(jetpg.AND(
			reactions.PostID.EQ(jetUUID(postID)), reactions.UserID.EQ(jetUUID(actorID)),
		)))
		if err != nil {
			return fluo.Post{}, err
		}
	} else {
		_, err := jetExec(ctx, store.pool, reactions.INSERT(reactions.PostID, reactions.UserID, reactions.Value).
			VALUES(jetUUID(postID), jetUUID(actorID), jetpg.String(*value)).
			ON_CONFLICT(reactions.PostID, reactions.UserID).DO_UPDATE(jetpg.SET(
			reactions.Value.SET(reactions.EXCLUDED.Value),
		)))
		if err != nil {
			return fluo.Post{}, err
		}
	}
	return store.Get(ctx, actorID, postID)
}

func (store *Fluo) Follow(ctx context.Context, actorID, targetID string, following bool) error {
	if actorID == targetID {
		return fluo.ErrSelfFollow
	}
	var exists bool
	users := table.Users
	if err := jetQueryRow(ctx, store.pool, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(users.ID).FROM(users).
		WHERE(users.ID.EQ(jetUUID(targetID)))))).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fluo.ErrNotFound
	}
	if following {
		follows := table.FluoFollows
		_, err := jetExec(ctx, store.pool, follows.INSERT(follows.FollowerID, follows.FollowedID).
			VALUES(jetUUID(actorID), jetUUID(targetID)).ON_CONFLICT().DO_NOTHING())
		return err
	}
	follows := table.FluoFollows
	_, err := jetExec(ctx, store.pool, follows.DELETE().WHERE(jetpg.AND(
		follows.FollowerID.EQ(jetUUID(actorID)), follows.FollowedID.EQ(jetUUID(targetID)),
	)))
	return err
}

var _ fluo.Store = (*Fluo)(nil)
