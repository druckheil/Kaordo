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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Fluo struct{ pool *pgxpool.Pool }

func NewFluo(pool *pgxpool.Pool) *Fluo { return &Fluo{pool: pool} }

const postColumns = `
	p.id::text, a.id::text, a.username, a.display_name,
	EXISTS (SELECT 1 FROM fluo_follows f WHERE f.follower_id = $1::uuid AND f.followed_id = a.id),
	p.content, p.plain_text, p.visibility, p.parent_id::text, p.quote_id::text,
	q.id::text, qa.id::text, qa.username, qa.display_name, q.plain_text,
	COALESCE((SELECT jsonb_agg(jsonb_build_object(
		'id', qm.upload_id::text, 'kind', qm.kind, 'mimeType', qm.mime_type,
		'width', qm.width, 'height', qm.height, 'size', qm.size_bytes, 'altText', qm.alt_text
	) ORDER BY qm.position) FROM fluo_post_media qm WHERE qm.post_id = q.id), '[]'::jsonb),
	COALESCE((SELECT count(*) FROM fluo_reactions r WHERE r.post_id = p.id AND r.value = 'good'), 0),
	COALESCE((SELECT count(*) FROM fluo_reactions r WHERE r.post_id = p.id AND r.value = 'bad'), 0),
	COALESCE((SELECT count(*) FROM fluo_posts c WHERE c.parent_id = p.id), 0),
	(SELECT r.value FROM fluo_reactions r WHERE r.post_id = p.id AND r.user_id = $1::uuid),
	EXISTS (SELECT 1 FROM fluo_saved_posts s WHERE s.user_id = $1::uuid AND s.post_id = p.id),
	COALESCE((SELECT jsonb_agg(jsonb_build_object(
		'id', m.upload_id::text, 'kind', m.kind, 'mimeType', m.mime_type,
		'width', m.width, 'height', m.height, 'size', m.size_bytes, 'altText', m.alt_text
	) ORDER BY m.position) FROM fluo_post_media m WHERE m.post_id = p.id), '[]'::jsonb),
	p.created_at, p.updated_at
`

const postJoins = `
	JOIN users a ON a.id = p.author_id
	LEFT JOIN fluo_posts q ON q.id = p.quote_id AND q.parent_id IS NULL AND q.visibility = 'public'
	LEFT JOIN users qa ON qa.id = q.author_id
`

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
	query := `SELECT ` + postColumns + ` FROM fluo_posts p ` + postJoins + `
		WHERE p.id = $2::uuid
		AND (p.visibility = 'public' OR p.author_id = $1::uuid)
		AND (p.parent_id IS NULL OR EXISTS (
			SELECT 1 FROM fluo_posts root WHERE root.id = p.parent_id
			AND (root.visibility = 'public' OR root.author_id = $1::uuid)
		))`
	post, err := scanPost(store.pool.QueryRow(ctx, query, viewerID, id))
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
	var cursorTime, cursorID any
	if options.Cursor != nil {
		cursorTime, cursorID = options.Cursor.CreatedAt, options.Cursor.ID
	}
	from := `FROM fluo_posts p`
	prefix := ""
	args := []any{options.ViewerID, options.ParentID, options.Feed, cursorTime, cursorID, options.Limit + 1}
	if options.Search != "" {
		// PostgreSQL can use pg_trgm and author indexes to build a small candidate
		// set before fetching the timeline. Escape user wildcards to preserve
		// literal case-insensitive substring search.
		search := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(options.Search) + "%"
		args = append(args, search)
		prefix = `WITH matching_posts AS (
			SELECT id FROM fluo_posts WHERE lower(plain_text) LIKE lower($7::text) ESCAPE '\'
			UNION
			SELECT p.id FROM users u JOIN fluo_posts p ON p.author_id = u.id
			WHERE lower(u.username) LIKE lower($7::text) ESCAPE '\'
				OR lower(u.display_name) LIKE lower($7::text) ESCAPE '\'
		) `
		from = `FROM matching_posts JOIN fluo_posts p ON p.id = matching_posts.id`
	}
	query := prefix + `SELECT ` + postColumns + ` ` + from + postJoins + `
		WHERE ($2::uuid IS NULL AND p.parent_id IS NULL OR p.parent_id = $2::uuid)
		AND (p.visibility = 'public' OR p.author_id = $1::uuid)
		AND ($2::uuid IS NOT NULL OR $3::text = 'latest'
			OR ($3::text = 'mine' AND p.author_id = $1::uuid)
			OR ($3::text = 'saved' AND EXISTS (
				SELECT 1 FROM fluo_saved_posts s WHERE s.user_id = $1::uuid AND s.post_id = p.id
			))
			OR ($3::text = 'following' AND (
				p.author_id = $1::uuid OR EXISTS (
					SELECT 1 FROM fluo_follows f
					WHERE f.follower_id = $1::uuid AND f.followed_id = p.author_id
				)
			)))
		AND ($4::timestamptz IS NULL OR (p.created_at, p.id) < ($4::timestamptz, $5::uuid))
		ORDER BY p.created_at DESC, p.id DESC LIMIT $6`
	rows, err := store.pool.Query(ctx, query, args...)
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
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, actorID); err != nil {
		return fluo.Post{}, err
	}
	var recent int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM fluo_posts WHERE author_id = $1::uuid AND created_at > now() - interval '1 minute'`, actorID).Scan(&recent); err != nil {
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
		err := tx.QueryRow(ctx, `SELECT visibility, author_id::text FROM fluo_posts
			WHERE id = $1::uuid AND parent_id IS NULL FOR SHARE`, *referenceID).Scan(&referenceVisibility, &referenceAuthor)
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
	err = tx.QueryRow(ctx, `INSERT INTO fluo_posts (author_id, content, plain_text, visibility, parent_id, quote_id)
		VALUES ($1::uuid, $2::jsonb, $3, $4, $5::uuid, $6::uuid) RETURNING id::text`,
		actorID, input.Content, text, visibility, input.ParentID, input.QuoteID).Scan(&id)
	if err != nil {
		return fluo.Post{}, err
	}
	claims := append([]fluo.Media(nil), media...)
	sort.Slice(claims, func(i, j int) bool { return claims[i].ID < claims[j].ID })
	for _, item := range claims {
		claimed, err := tx.Exec(ctx, `INSERT INTO nodo_upload_claims (upload_id, owner_id)
			VALUES ($1::uuid, $2::uuid)
			ON CONFLICT (upload_id) DO UPDATE SET owner_id = EXCLUDED.owner_id
			WHERE nodo_upload_claims.owner_id = EXCLUDED.owner_id
			AND nodo_upload_claims.retired_at IS NULL`, item.ID, actorID)
		if err != nil {
			return fluo.Post{}, err
		}
		if claimed.RowsAffected() == 0 {
			return fluo.Post{}, fluo.ErrMediaOwner
		}
	}
	for position, item := range media {
		_, err = tx.Exec(ctx, `INSERT INTO fluo_post_media
			(post_id, upload_id, position, kind, mime_type, width, height, size_bytes, alt_text)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)`,
			id, item.ID, position, item.Kind, item.MimeType, item.Width, item.Height, item.Size, item.AltText)
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
	if err := tx.QueryRow(ctx, `SELECT id::text FROM fluo_posts WHERE id = $1::uuid AND author_id = $2::uuid FOR UPDATE`, id, actorID).Scan(&lockedID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fluo.ErrNotFound
		}
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT DISTINCT upload_id::text FROM fluo_post_media WHERE post_id = $1::uuid
		OR post_id IN (SELECT id FROM fluo_posts WHERE parent_id = $1::uuid)
		ORDER BY upload_id::text`, id)
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
	for _, mediaID := range ids {
		var lockedID string
		if err := tx.QueryRow(ctx, `SELECT upload_id::text FROM nodo_upload_claims
			WHERE upload_id = $1::uuid FOR UPDATE`, mediaID).Scan(&lockedID); err != nil {
			return nil, fmt.Errorf("lock media claim %s: %w", mediaID, err)
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM fluo_posts WHERE id = $1::uuid`, id); err != nil {
		return nil, err
	}
	retiredIDs := make([]string, 0, len(ids))
	for _, mediaID := range ids {
		result, err := tx.Exec(ctx, `UPDATE nodo_upload_claims AS claim SET retired_at = now()
			WHERE claim.upload_id = $1::uuid AND claim.retired_at IS NULL
			AND NOT EXISTS (SELECT 1 FROM fluo_post_media AS media WHERE media.upload_id = claim.upload_id)
			AND NOT EXISTS (SELECT 1 FROM ligo_message_media AS media WHERE media.upload_id = claim.upload_id)`, mediaID)
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
	err := store.pool.QueryRow(ctx, `SELECT
		EXISTS(SELECT 1 FROM fluo_post_media WHERE upload_id = $1::uuid)
		OR EXISTS(SELECT 1 FROM ligo_message_media WHERE upload_id = $1::uuid)
		OR EXISTS(SELECT 1 FROM nodo_upload_claims WHERE upload_id = $1::uuid AND retired_at IS NULL)`, id).Scan(&referenced)
	return referenced, err
}

func (store *Fluo) SetSaved(ctx context.Context, viewerID, postID string, saved bool) error {
	if _, err := store.Get(ctx, viewerID, postID); err != nil {
		return err
	}
	if saved {
		_, err := store.pool.Exec(ctx, `INSERT INTO fluo_saved_posts (user_id, post_id)
			VALUES ($1::uuid, $2::uuid) ON CONFLICT (user_id, post_id) DO NOTHING`, viewerID, postID)
		return err
	}
	_, err := store.pool.Exec(ctx, `DELETE FROM fluo_saved_posts WHERE user_id = $1::uuid AND post_id = $2::uuid`, viewerID, postID)
	return err
}

func (store *Fluo) React(ctx context.Context, actorID, postID string, value *string) (fluo.Post, error) {
	if _, err := store.Get(ctx, actorID, postID); err != nil {
		return fluo.Post{}, err
	}
	if value == nil {
		_, err := store.pool.Exec(ctx, `DELETE FROM fluo_reactions WHERE post_id = $1::uuid AND user_id = $2::uuid`, postID, actorID)
		if err != nil {
			return fluo.Post{}, err
		}
	} else {
		_, err := store.pool.Exec(ctx, `INSERT INTO fluo_reactions (post_id, user_id, value)
			VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT (post_id, user_id)
			DO UPDATE SET value = EXCLUDED.value`, postID, actorID, *value)
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
	if err := store.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1::uuid)`, targetID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fluo.ErrNotFound
	}
	if following {
		_, err := store.pool.Exec(ctx, `INSERT INTO fluo_follows (follower_id, followed_id) VALUES ($1::uuid, $2::uuid)
			ON CONFLICT DO NOTHING`, actorID, targetID)
		return err
	}
	_, err := store.pool.Exec(ctx, `DELETE FROM fluo_follows WHERE follower_id = $1::uuid AND followed_id = $2::uuid`, actorID, targetID)
	return err
}

var _ fluo.Store = (*Fluo)(nil)
