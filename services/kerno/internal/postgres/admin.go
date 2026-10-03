package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrAdminTarget = errors.New("admin target is unavailable")
var ErrAccessLimit = errors.New("too many recent access cases")

type Admin struct{ pool *pgxpool.Pool }

func NewAdmin(pool *pgxpool.Pool) *Admin { return &Admin{pool: pool} }

type AdminSummary struct {
	Users         int64             `json:"users"`
	Posts         int64             `json:"posts"`
	Messages      int64             `json:"messages"`
	Uploads       int64             `json:"uploads"`
	MediaBytes    int64             `json:"mediaBytes"`
	DatabaseBytes int64             `json:"databaseBytes"`
	OpenCases     int64             `json:"openCases"`
	MediaByKind   []AdminMediaUsage `json:"mediaByKind"`
}

type AdminMediaUsage struct {
	Kind    string `json:"kind"`
	Objects int64  `json:"objects"`
	Bytes   int64  `json:"bytes"`
}

func (store *Admin) Summary(ctx context.Context) (AdminSummary, error) {
	var summary AdminSummary
	var breakdown []byte
	err := store.pool.QueryRow(ctx, `WITH referenced_media AS (
		SELECT DISTINCT ON (upload_id) upload_id, kind, size_bytes FROM (
			SELECT upload_id, kind, size_bytes FROM fluo_post_media
			UNION ALL SELECT upload_id, kind, size_bytes FROM ligo_message_media
		) media ORDER BY upload_id
	), usage AS (
		SELECT kind, count(*) AS objects, sum(size_bytes) AS bytes FROM referenced_media GROUP BY kind
	) SELECT
		(SELECT count(*) FROM users),
		(SELECT count(*) FROM fluo_posts),
		(SELECT count(*) FROM ligo_messages WHERE deleted_at IS NULL AND NOT system_notice),
		(SELECT count(*) FROM nodo_upload_claims WHERE retired_at IS NULL),
		COALESCE((SELECT sum(size_bytes) FROM referenced_media), 0),
		pg_database_size(current_database()),
		(SELECT count(*) FROM admin_access_cases WHERE expires_at > clock_timestamp()),
		COALESCE((SELECT jsonb_agg(to_jsonb(usage) ORDER BY kind) FROM usage), '[]'::jsonb)`).Scan(
		&summary.Users, &summary.Posts, &summary.Messages, &summary.Uploads, &summary.MediaBytes, &summary.DatabaseBytes, &summary.OpenCases, &breakdown)
	if err != nil {
		return summary, err
	}
	return summary, json.Unmarshal(breakdown, &summary.MediaByKind)
}

type AdminUser struct {
	ID           string     `json:"id"`
	Username     string     `json:"username"`
	DisplayName  string     `json:"displayName"`
	IsAdmin      bool       `json:"isAdmin"`
	DisabledAt   *time.Time `json:"disabledAt"`
	PostCount    int64      `json:"postCount"`
	MessageCount int64      `json:"messageCount"`
	MediaBytes   int64      `json:"mediaBytes"`
	LastActivity *time.Time `json:"lastActivity"`
	CreatedAt    time.Time  `json:"createdAt"`
}

const adminUserSelect = `SELECT u.id::text, u.username, u.display_name,
	EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'admin'), u.disabled_at,
	(SELECT count(*) FROM fluo_posts p WHERE p.author_id = u.id),
	(SELECT count(*) FROM ligo_messages m WHERE m.sender_id = u.id AND m.deleted_at IS NULL AND NOT m.system_notice),
	COALESCE((SELECT sum(refs.size_bytes) FROM (
		SELECT DISTINCT ON (upload_id) upload_id, size_bytes FROM (
			SELECT f.upload_id, f.size_bytes FROM fluo_post_media f
			JOIN nodo_upload_claims c ON c.upload_id = f.upload_id WHERE c.owner_id = u.id
			UNION ALL
			SELECT m.upload_id, m.size_bytes FROM ligo_message_media m
			JOIN nodo_upload_claims c ON c.upload_id = m.upload_id WHERE c.owner_id = u.id
		) media ORDER BY upload_id
	) refs), 0),
	GREATEST((SELECT max(created_at) FROM fluo_posts p WHERE p.author_id = u.id),
		(SELECT max(created_at) FROM ligo_messages m WHERE m.sender_id = u.id AND NOT m.system_notice)), u.created_at
	FROM users u`

func scanAdminUser(row pgx.Row) (AdminUser, error) {
	var user AdminUser
	err := row.Scan(&user.ID, &user.Username, &user.DisplayName, &user.IsAdmin, &user.DisabledAt,
		&user.PostCount, &user.MessageCount, &user.MediaBytes, &user.LastActivity, &user.CreatedAt)
	return user, err
}

func (store *Admin) Users(ctx context.Context, search string) ([]AdminUser, error) {
	search = strings.TrimSpace(search)
	literal := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search)
	rows, err := store.pool.Query(ctx, adminUserSelect+` WHERE ($1 = '' OR
		lower(u.username) LIKE '%' || lower($1) || '%' ESCAPE '\' OR
		lower(u.display_name) LIKE '%' || lower($1) || '%' ESCAPE '\')
		ORDER BY lower(u.username), u.id LIMIT 100`, literal)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := make([]AdminUser, 0)
	for rows.Next() {
		user, err := scanAdminUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (store *Admin) SetDisabled(ctx context.Context, actorID, targetID string, disabled bool, reason string) (AdminUser, error) {
	if actorID == targetID {
		return AdminUser{}, ErrAdminTarget
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return AdminUser{}, err
	}
	defer tx.Rollback(ctx)
	var admin bool
	err = tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = id AND role = 'admin')
		FROM users WHERE id = $1::uuid FOR UPDATE`, targetID).Scan(&admin)
	if errors.Is(err, pgx.ErrNoRows) || admin {
		return AdminUser{}, ErrAdminTarget
	}
	if err != nil {
		return AdminUser{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET disabled_at = CASE WHEN $2 THEN clock_timestamp() ELSE NULL END,
		disabled_reason = CASE WHEN $2 THEN $3 ELSE '' END, updated_at = clock_timestamp()
		WHERE id = $1::uuid`, targetID, disabled, reason); err != nil {
		return AdminUser{}, err
	}
	action := "user.enabled"
	if disabled {
		action = "user.disabled"
	}
	if _, err := tx.Exec(ctx, `INSERT INTO admin_audit (actor_id, target_user_id, action, reason)
		VALUES ($1::uuid, $2::uuid, $3, $4)`, actorID, targetID, action, reason); err != nil {
		return AdminUser{}, err
	}
	user, err := scanAdminUser(tx.QueryRow(ctx, adminUserSelect+` WHERE u.id = $1::uuid`, targetID))
	if err != nil {
		return AdminUser{}, err
	}
	return user, tx.Commit(ctx)
}

func (store *Admin) SetAdmin(ctx context.Context, actorID, targetID string, enabled bool, reason string) (AdminUser, error) {
	if actorID == targetID {
		return AdminUser{}, ErrAdminTarget
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return AdminUser{}, err
	}
	defer tx.Rollback(ctx)
	// Serialize role changes and recheck the actor to prevent concurrent mutual
	// revocations from removing every administrator.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(776620003)`); err != nil {
		return AdminUser{}, err
	}
	var allowed bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users u JOIN user_roles r ON r.user_id = u.id
		WHERE u.id = $1::uuid AND r.role = 'admin' AND u.disabled_at IS NULL)`, actorID).Scan(&allowed); err != nil {
		return AdminUser{}, err
	}
	if !allowed {
		return AdminUser{}, ErrAdminTarget
	}
	var disabled bool
	if err := tx.QueryRow(ctx, `SELECT disabled_at IS NOT NULL FROM users WHERE id = $1::uuid FOR UPDATE`, targetID).Scan(&disabled); errors.Is(err, pgx.ErrNoRows) {
		return AdminUser{}, ErrAdminTarget
	} else if err != nil {
		return AdminUser{}, err
	}
	if enabled && disabled {
		return AdminUser{}, ErrAdminTarget
	}
	if enabled {
		_, err = tx.Exec(ctx, `INSERT INTO user_roles (user_id, role) VALUES ($1::uuid, 'admin') ON CONFLICT DO NOTHING`, targetID)
	} else {
		_, err = tx.Exec(ctx, `DELETE FROM user_roles WHERE user_id = $1::uuid AND role = 'admin'`, targetID)
	}
	if err != nil {
		return AdminUser{}, err
	}
	action := "user.admin_revoked"
	if enabled {
		action = "user.admin_granted"
	}
	if _, err := tx.Exec(ctx, `INSERT INTO admin_audit (actor_id, target_user_id, action, reason)
		VALUES ($1::uuid, $2::uuid, $3, $4)`, actorID, targetID, action, reason); err != nil {
		return AdminUser{}, err
	}
	user, err := scanAdminUser(tx.QueryRow(ctx, adminUserSelect+` WHERE u.id = $1::uuid`, targetID))
	if err != nil {
		return AdminUser{}, err
	}
	return user, tx.Commit(ctx)
}

type AdminAuditEntry struct {
	ID        string          `json:"id"`
	Actor     string          `json:"actor"`
	Target    *string         `json:"target"`
	Action    string          `json:"action"`
	Reason    string          `json:"reason"`
	Detail    json.RawMessage `json:"detail"`
	CreatedAt time.Time       `json:"createdAt"`
}

func (store *Admin) Audit(ctx context.Context) ([]AdminAuditEntry, error) {
	rows, err := store.pool.Query(ctx, `SELECT a.id::text, actor.username, target.username, a.action, a.reason,
		a.detail, a.created_at FROM admin_audit a
		JOIN users actor ON actor.id = a.actor_id
		LEFT JOIN users target ON target.id = a.target_user_id
		ORDER BY a.created_at DESC, a.id DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AdminAuditEntry, 0)
	for rows.Next() {
		var item AdminAuditEntry
		if err := rows.Scan(&item.ID, &item.Actor, &item.Target, &item.Action,
			&item.Reason, &item.Detail, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *Admin) Record(ctx context.Context, actorID, targetID, action, reason string, detail any) error {
	encoded, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("encode audit detail: %w", err)
	}
	_, err = store.pool.Exec(ctx, `INSERT INTO admin_audit (actor_id, target_user_id, action, reason, detail)
		VALUES ($1::uuid, NULLIF($2::text, '')::uuid, $3, $4, $5::jsonb)`, actorID, targetID, action, reason, encoded)
	return err
}

type AdminAccessCase struct {
	ID             string    `json:"id"`
	TargetUserID   string    `json:"targetUserId"`
	TargetUsername string    `json:"targetUsername"`
	Reason         string    `json:"reason"`
	CreatedAt      time.Time `json:"createdAt"`
	ExpiresAt      time.Time `json:"expiresAt"`
}

func (store *Admin) CreateAccessCase(ctx context.Context, actorID, targetID, reason string) (AdminAccessCase, error) {
	if actorID == targetID {
		return AdminAccessCase{}, ErrAdminTarget
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return AdminAccessCase{}, err
	}
	defer tx.Rollback(ctx)
	var actorName string
	if err := tx.QueryRow(ctx, `SELECT username FROM users WHERE id = $1::uuid FOR UPDATE`, actorID).Scan(&actorName); err != nil {
		return AdminAccessCase{}, err
	}
	var recent int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM admin_access_cases
		WHERE actor_id = $1::uuid AND created_at > clock_timestamp() - interval '1 hour'`, actorID).Scan(&recent); err != nil {
		return AdminAccessCase{}, err
	}
	if recent >= 3 {
		return AdminAccessCase{}, ErrAccessLimit
	}
	var item AdminAccessCase
	if err := tx.QueryRow(ctx, `SELECT id::text, username FROM users WHERE id = $1::uuid FOR SHARE`, targetID).
		Scan(&item.TargetUserID, &item.TargetUsername); errors.Is(err, pgx.ErrNoRows) {
		return AdminAccessCase{}, ErrAdminTarget
	} else if err != nil {
		return AdminAccessCase{}, err
	}
	item.Reason = reason
	if err := tx.QueryRow(ctx, `INSERT INTO admin_access_cases (actor_id, target_user_id, reason)
		VALUES ($1::uuid, $2::uuid, $3)
		RETURNING id::text, created_at, expires_at`, actorID, targetID, reason).
		Scan(&item.ID, &item.CreatedAt, &item.ExpiresAt); err != nil {
		return AdminAccessCase{}, err
	}
	var conversationID string
	if err := tx.QueryRow(ctx, `INSERT INTO ligo_conversations (kind, created_by)
		VALUES ('self', $1::uuid)
		ON CONFLICT (created_by) WHERE kind = 'self' DO UPDATE SET created_by = EXCLUDED.created_by
		RETURNING id::text`, targetID).Scan(&conversationID); err != nil {
		return AdminAccessCase{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO ligo_members (conversation_id, user_id)
		VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, conversationID, targetID); err != nil {
		return AdminAccessCase{}, err
	}
	notice := fmt.Sprintf("Administrator @%s opened a 15-minute access case for content associated with your account. Reason: %s. Case ID: %s", actorName, reason, item.ID)
	if _, err := tx.Exec(ctx, `INSERT INTO ligo_messages (conversation_id, sender_id, client_id, body, system_notice)
		VALUES ($1::uuid, $2::uuid, uuidv7(), $3, true)`, conversationID, targetID, notice); err != nil {
		return AdminAccessCase{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE ligo_conversations SET updated_at = clock_timestamp()
		WHERE id = $1::uuid`, conversationID); err != nil {
		return AdminAccessCase{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO admin_audit (actor_id, target_user_id, action, reason, detail)
		VALUES ($1::uuid, $2::uuid, 'case.opened', $3, jsonb_build_object('caseId', $4::text))`,
		actorID, targetID, reason, item.ID); err != nil {
		return AdminAccessCase{}, err
	}
	if _, err := tx.Exec(ctx, `SELECT pg_notify('ligo_activity', $1)`, conversationID); err != nil {
		return AdminAccessCase{}, err
	}
	return item, tx.Commit(ctx)
}

func (store *Admin) AccessCase(ctx context.Context, actorID, caseID string) (AdminAccessCase, error) {
	var item AdminAccessCase
	err := store.pool.QueryRow(ctx, `SELECT c.id::text, c.target_user_id::text, u.username,
		c.reason, c.created_at, c.expires_at FROM admin_access_cases c
		JOIN users u ON u.id = c.target_user_id
		WHERE c.id = $1::uuid AND c.actor_id = $2::uuid AND c.expires_at > clock_timestamp()`,
		caseID, actorID).Scan(&item.ID, &item.TargetUserID, &item.TargetUsername,
		&item.Reason, &item.CreatedAt, &item.ExpiresAt)
	return item, err
}

func (store *Admin) CloseCase(ctx context.Context, actorID, caseID string) error {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var targetID, reason string
	if err := tx.QueryRow(ctx, `SELECT target_user_id::text, reason FROM admin_access_cases
		WHERE id = $1::uuid AND actor_id = $2::uuid FOR UPDATE`, caseID, actorID).Scan(&targetID, &reason); err != nil {
		return err
	}
	result, err := tx.Exec(ctx, `UPDATE admin_access_cases SET expires_at = clock_timestamp()
		WHERE id = $1::uuid AND expires_at > clock_timestamp()`, caseID)
	if err != nil {
		return err
	}
	if result.RowsAffected() > 0 {
		if _, err := tx.Exec(ctx, `INSERT INTO admin_audit (actor_id, target_user_id, action, reason, detail)
			VALUES ($1::uuid, $2::uuid, 'case.closed', $3, jsonb_build_object('caseId', $4::text))`, actorID, targetID, reason, caseID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

type AdminContentMedia struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	MimeType string `json:"mimeType"`
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
	URL      string `json:"url"`
}

type AdminContent struct {
	ID        string              `json:"id"`
	Text      string              `json:"text"`
	Context   string              `json:"context"`
	CreatedAt time.Time           `json:"createdAt"`
	Media     []AdminContentMedia `json:"media"`
}

type AdminContentPage struct {
	Items      []AdminContent `json:"items"`
	NextCursor *string        `json:"nextCursor"`
}

func (store *Admin) CaseContent(ctx context.Context, targetID, kind, before string) (AdminContentPage, error) {
	var query string
	switch kind {
	case "posts":
		query = `SELECT p.id::text, p.plain_text, p.visibility, p.created_at,
			COALESCE(jsonb_agg(jsonb_build_object('id', m.upload_id::text, 'kind', m.kind,
				'mimeType', m.mime_type, 'filename', '', 'size', m.size_bytes)
				ORDER BY m.position) FILTER (WHERE m.upload_id IS NOT NULL), '[]'::jsonb)
			FROM fluo_posts p LEFT JOIN fluo_post_media m ON m.post_id = p.id
			WHERE p.author_id = $1::uuid AND ($2::uuid IS NULL OR p.id < $2::uuid)
			GROUP BY p.id ORDER BY p.id DESC LIMIT 51`
	case "messages":
		query = `SELECT m.id::text, m.body, c.kind, m.created_at,
			COALESCE(jsonb_agg(jsonb_build_object('id', media.upload_id::text, 'kind', media.kind,
				'mimeType', media.mime_type, 'filename', media.filename, 'size', media.size_bytes)
				ORDER BY media.position) FILTER (WHERE media.upload_id IS NOT NULL), '[]'::jsonb)
			FROM ligo_messages m JOIN ligo_conversations c ON c.id = m.conversation_id
			LEFT JOIN ligo_message_media media ON media.message_id = m.id
			WHERE m.sender_id = $1::uuid AND m.deleted_at IS NULL AND NOT m.system_notice
			AND ($2::uuid IS NULL OR m.id < $2::uuid)
			GROUP BY m.id, c.kind ORDER BY m.id DESC LIMIT 51`
	default:
		return AdminContentPage{}, errors.New("unsupported case content type")
	}
	var cursor any
	if before != "" {
		cursor = before
	}
	rows, err := store.pool.Query(ctx, query, targetID, cursor)
	if err != nil {
		return AdminContentPage{}, err
	}
	defer rows.Close()
	page := AdminContentPage{Items: make([]AdminContent, 0)}
	for rows.Next() {
		var item AdminContent
		var media []byte
		if err := rows.Scan(&item.ID, &item.Text, &item.Context, &item.CreatedAt, &media); err != nil {
			return AdminContentPage{}, err
		}
		if err := json.Unmarshal(media, &item.Media); err != nil {
			return AdminContentPage{}, err
		}
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return AdminContentPage{}, err
	}
	if len(page.Items) > 50 {
		page.Items = page.Items[:50]
		last := page.Items[len(page.Items)-1].ID
		page.NextCursor = &last
	}
	return page, nil
}
