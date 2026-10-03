package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
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
	users := table.Users
	posts := table.FluoPosts
	messages := table.LigoMessages
	claims := table.NodoUploadClaims
	cases := table.AdminAccessCases
	query := jetpg.SELECT(
		jetpg.COUNT(users.ID), jetpg.SELECT(jetpg.COUNT(posts.ID)).FROM(posts),
		jetpg.SELECT(jetpg.COUNT(messages.ID)).FROM(messages).WHERE(jetpg.AND(messages.DeletedAt.IS_NULL(), messages.SystemNotice.IS_FALSE())),
		jetpg.SELECT(jetpg.COUNT(claims.UploadID)).FROM(claims).WHERE(claims.RetiredAt.IS_NULL()),
		jetpg.RawInt(`COALESCE((SELECT sum(size_bytes) FROM (
			SELECT DISTINCT ON (upload_id) upload_id, size_bytes FROM (
				SELECT upload_id, size_bytes FROM fluo_post_media
				UNION ALL SELECT upload_id, size_bytes FROM ligo_message_media
			) referenced ORDER BY upload_id
		) unique_media), 0)`),
		jetpg.RawInt("pg_database_size(current_database())"),
		jetpg.SELECT(jetpg.COUNT(cases.ID)).FROM(cases).WHERE(cases.ExpiresAt.GT(jetpg.RawTimestampz("clock_timestamp()"))),
		jetpg.RawString(`COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', usage.kind,
			'objects', usage.objects, 'bytes', usage.bytes) ORDER BY usage.kind) FROM (
			SELECT kind, count(*) AS objects, sum(size_bytes) AS bytes FROM (
				SELECT DISTINCT ON (upload_id) upload_id, kind, size_bytes FROM (
					SELECT upload_id, kind, size_bytes FROM fluo_post_media
					UNION ALL SELECT upload_id, kind, size_bytes FROM ligo_message_media
				) referenced ORDER BY upload_id
			) unique_media GROUP BY kind
		) usage), '[]'::jsonb)`),
	).FROM(users)
	err := jetQueryRow(ctx, store.pool, query).Scan(
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

func adminUserQuery() (jetpg.SelectStatement, *table.UsersTable) {
	u := table.Users.AS("u")
	r := table.UserRoles.AS("r")
	p := table.FluoPosts.AS("p")
	m := table.LigoMessages.AS("m")
	return jetpg.SELECT(jetpg.CAST(u.ID).AS_TEXT(), u.Username, u.DisplayName,
		jetpg.EXISTS(jetpg.SELECT(r.UserID).FROM(r).WHERE(jetpg.AND(r.UserID.EQ(u.ID), r.Role.EQ(jetpg.String("admin"))))),
		u.DisabledAt,
		jetpg.SELECT(jetpg.COUNT(p.ID)).FROM(p).WHERE(p.AuthorID.EQ(u.ID)),
		jetpg.SELECT(jetpg.COUNT(m.ID)).FROM(m).WHERE(jetpg.AND(m.SenderID.EQ(u.ID), m.DeletedAt.IS_NULL(), m.SystemNotice.IS_FALSE())),
		jetpg.RawInt(`COALESCE((SELECT sum(refs.size_bytes) FROM (
			SELECT DISTINCT ON (upload_id) upload_id, size_bytes FROM (
				SELECT f.upload_id, f.size_bytes FROM fluo_post_media f
				JOIN nodo_upload_claims c ON c.upload_id = f.upload_id WHERE c.owner_id = u.id
				UNION ALL
				SELECT lm.upload_id, lm.size_bytes FROM ligo_message_media lm
				JOIN nodo_upload_claims c ON c.upload_id = lm.upload_id WHERE c.owner_id = u.id
			) media ORDER BY upload_id
		) refs), 0)`),
		jetpg.RawTimestampz(`GREATEST((SELECT max(created_at) FROM fluo_posts p WHERE p.author_id = u.id),
			(SELECT max(created_at) FROM ligo_messages m WHERE m.sender_id = u.id AND NOT m.system_notice))`),
		u.CreatedAt,
	).FROM(u), u
}

func scanAdminUser(row pgx.Row) (AdminUser, error) {
	var user AdminUser
	err := row.Scan(&user.ID, &user.Username, &user.DisplayName, &user.IsAdmin, &user.DisabledAt,
		&user.PostCount, &user.MessageCount, &user.MediaBytes, &user.LastActivity, &user.CreatedAt)
	return user, err
}

func (store *Admin) Users(ctx context.Context, search string) ([]AdminUser, error) {
	search = strings.TrimSpace(search)
	literal := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search)
	query, u := adminUserQuery()
	condition := jetpg.Bool(true)
	if literal != "" {
		pattern := jetpg.String("%" + literal + "%")
		condition = jetpg.OR(jetpg.LOWER(u.Username).LIKE(pattern), jetpg.LOWER(u.DisplayName).LIKE(pattern))
	}
	rows, err := jetQuery(ctx, store.pool, query.WHERE(condition).
		ORDER_BY(jetpg.LOWER(u.Username).ASC(), u.ID.ASC()).LIMIT(100))
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
	users := table.Users
	roles := table.UserRoles.AS("roles")
	err = jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(roles.UserID).FROM(roles).
		WHERE(jetpg.AND(roles.UserID.EQ(users.ID), roles.Role.EQ(jetpg.String("admin")))))).
		FROM(users).WHERE(users.ID.EQ(jetUUID(targetID))).FOR(jetpg.UPDATE())).Scan(&admin)
	if errors.Is(err, pgx.ErrNoRows) || admin {
		return AdminUser{}, ErrAdminTarget
	}
	if err != nil {
		return AdminUser{}, err
	}
	if _, err := jetExec(ctx, tx, users.UPDATE().SET(
		users.DisabledAt.SET(jetpg.RawTimestampz("CASE WHEN #disabled THEN clock_timestamp() ELSE NULL END", jetpg.RawArgs{"#disabled": disabled})),
		users.DisabledReason.SET(jetpg.RawString("CASE WHEN #disabled THEN #reason ELSE '' END", jetpg.RawArgs{"#disabled": disabled, "#reason": reason})),
		users.UpdatedAt.SET(jetpg.RawTimestampz("clock_timestamp()")),
	).WHERE(users.ID.EQ(jetUUID(targetID)))); err != nil {
		return AdminUser{}, err
	}
	action := "user.enabled"
	if disabled {
		action = "user.disabled"
	}
	audit := table.AdminAudit
	if _, err := jetExec(ctx, tx, audit.INSERT(audit.ActorID, audit.TargetUserID, audit.Action, audit.Reason).
		VALUES(jetUUID(actorID), jetUUID(targetID), jetpg.String(action), jetpg.String(reason))); err != nil {
		return AdminUser{}, err
	}
	query, userTable := adminUserQuery()
	user, err := scanAdminUser(jetQueryRow(ctx, tx, query.WHERE(userTable.ID.EQ(jetUUID(targetID)))))
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
	if err := jetAdvisoryLock(ctx, tx, jetpg.RawString("pg_advisory_xact_lock(776620003)")); err != nil {
		return AdminUser{}, err
	}
	var allowed bool
	u := table.Users.AS("actor")
	r := table.UserRoles.AS("role")
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(r.UserID).
		FROM(u.INNER_JOIN(r, r.UserID.EQ(u.ID))).WHERE(jetpg.AND(
		u.ID.EQ(jetUUID(actorID)), r.Role.EQ(jetpg.String("admin")), u.DisabledAt.IS_NULL(),
	))))).Scan(&allowed); err != nil {
		return AdminUser{}, err
	}
	if !allowed {
		return AdminUser{}, ErrAdminTarget
	}
	var disabled bool
	target := table.Users
	if err := jetQueryRow(ctx, tx, target.SELECT(jetpg.RawBool("disabled_at IS NOT NULL")).
		WHERE(target.ID.EQ(jetUUID(targetID))).FOR(jetpg.UPDATE())).Scan(&disabled); errors.Is(err, pgx.ErrNoRows) {
		return AdminUser{}, ErrAdminTarget
	} else if err != nil {
		return AdminUser{}, err
	}
	if enabled && disabled {
		return AdminUser{}, ErrAdminTarget
	}
	if enabled {
		roles := table.UserRoles
		_, err = jetExec(ctx, tx, roles.INSERT(roles.UserID, roles.Role).
			VALUES(jetUUID(targetID), jetpg.String("admin")).ON_CONFLICT().DO_NOTHING())
	} else {
		roles := table.UserRoles
		_, err = jetExec(ctx, tx, roles.DELETE().WHERE(jetpg.AND(
			roles.UserID.EQ(jetUUID(targetID)), roles.Role.EQ(jetpg.String("admin")),
		)))
	}
	if err != nil {
		return AdminUser{}, err
	}
	action := "user.admin_revoked"
	if enabled {
		action = "user.admin_granted"
	}
	audit := table.AdminAudit
	if _, err := jetExec(ctx, tx, audit.INSERT(audit.ActorID, audit.TargetUserID, audit.Action, audit.Reason).
		VALUES(jetUUID(actorID), jetUUID(targetID), jetpg.String(action), jetpg.String(reason))); err != nil {
		return AdminUser{}, err
	}
	query, userTable := adminUserQuery()
	user, err := scanAdminUser(jetQueryRow(ctx, tx, query.WHERE(userTable.ID.EQ(jetUUID(targetID)))))
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
	audit := table.AdminAudit.AS("a")
	actor := table.Users.AS("actor")
	target := table.Users.AS("target")
	rows, err := jetQuery(ctx, store.pool, jetpg.SELECT(jetpg.CAST(audit.ID).AS_TEXT(), actor.Username, target.Username,
		audit.Action, audit.Reason, audit.Detail, audit.CreatedAt).
		FROM(audit.INNER_JOIN(actor, actor.ID.EQ(audit.ActorID)).
			LEFT_JOIN(target, target.ID.EQ(audit.TargetUserID))).
		ORDER_BY(audit.CreatedAt.DESC(), audit.ID.DESC()).LIMIT(100))
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
	var target *string
	if targetID != "" {
		target = &targetID
	}
	audit := table.AdminAudit
	_, err = jetExec(ctx, store.pool, audit.INSERT(audit.ActorID, audit.TargetUserID, audit.Action, audit.Reason, audit.Detail).
		VALUES(jetUUID(actorID), nullableUUID(target), jetpg.String(action), jetpg.String(reason), jetpg.Json(encoded)))
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
	users := table.Users
	if err := jetQueryRow(ctx, tx, users.SELECT(users.Username).
		WHERE(users.ID.EQ(jetUUID(actorID))).FOR(jetpg.UPDATE())).Scan(&actorName); err != nil {
		return AdminAccessCase{}, err
	}
	var recent int
	cases := table.AdminAccessCases
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(cases.ID)).FROM(cases).WHERE(jetpg.AND(
		cases.ActorID.EQ(jetUUID(actorID)), cases.CreatedAt.GT(jetpg.RawTimestampz("clock_timestamp() - interval '1 hour'")),
	))).Scan(&recent); err != nil {
		return AdminAccessCase{}, err
	}
	if recent >= 3 {
		return AdminAccessCase{}, ErrAccessLimit
	}
	var item AdminAccessCase
	if err := jetQueryRow(ctx, tx, users.SELECT(jetpg.CAST(users.ID).AS_TEXT(), users.Username).
		WHERE(users.ID.EQ(jetUUID(targetID))).FOR(jetpg.SHARE())).
		Scan(&item.TargetUserID, &item.TargetUsername); errors.Is(err, pgx.ErrNoRows) {
		return AdminAccessCase{}, ErrAdminTarget
	} else if err != nil {
		return AdminAccessCase{}, err
	}
	item.Reason = reason
	if err := jetQueryRow(ctx, tx, cases.INSERT(cases.ActorID, cases.TargetUserID, cases.Reason).
		VALUES(jetUUID(actorID), jetUUID(targetID), jetpg.String(reason)).
		RETURNING(jetpg.CAST(cases.ID).AS_TEXT(), cases.CreatedAt, cases.ExpiresAt)).
		Scan(&item.ID, &item.CreatedAt, &item.ExpiresAt); err != nil {
		return AdminAccessCase{}, err
	}
	var conversationID string
	conversations := table.LigoConversations
	if err := jetQueryRow(ctx, tx, conversations.INSERT(conversations.Kind, conversations.CreatedBy).
		VALUES(jetpg.String("self"), jetUUID(targetID)).
		ON_CONFLICT(conversations.CreatedBy).WHERE(conversations.Kind.EQ(jetpg.String("self"))).
		DO_UPDATE(jetpg.SET(conversations.CreatedBy.SET(conversations.EXCLUDED.CreatedBy))).
		RETURNING(jetpg.CAST(conversations.ID).AS_TEXT())).Scan(&conversationID); err != nil {
		return AdminAccessCase{}, err
	}
	members := table.LigoMembers
	if _, err := jetExec(ctx, tx, members.INSERT(members.ConversationID, members.UserID).
		VALUES(jetUUID(conversationID), jetUUID(targetID)).ON_CONFLICT().DO_NOTHING()); err != nil {
		return AdminAccessCase{}, err
	}
	notice := fmt.Sprintf("Administrator @%s opened a 15-minute access case for content associated with your account. Reason: %s. Case ID: %s", actorName, reason, item.ID)
	messages := table.LigoMessages
	if _, err := jetExec(ctx, tx, messages.INSERT(messages.ConversationID, messages.SenderID, messages.ClientID, messages.Body, messages.SystemNotice).
		VALUES(jetUUID(conversationID), jetUUID(targetID), jetpg.RawString("uuidv7()"), jetpg.String(notice), jetpg.Bool(true))); err != nil {
		return AdminAccessCase{}, err
	}
	if _, err := jetExec(ctx, tx, conversations.UPDATE().SET(
		conversations.UpdatedAt.SET(jetpg.RawTimestampz("clock_timestamp()")),
	).WHERE(conversations.ID.EQ(jetUUID(conversationID)))); err != nil {
		return AdminAccessCase{}, err
	}
	audit := table.AdminAudit
	detail, _ := json.Marshal(map[string]string{"caseId": item.ID})
	if _, err := jetExec(ctx, tx, audit.INSERT(audit.ActorID, audit.TargetUserID, audit.Action, audit.Reason, audit.Detail).
		VALUES(jetUUID(actorID), jetUUID(targetID), jetpg.String("case.opened"), jetpg.String(reason), jetpg.Json(detail))); err != nil {
		return AdminAccessCase{}, err
	}
	if err := jetNotify(ctx, tx, "ligo_activity", conversationID); err != nil {
		return AdminAccessCase{}, err
	}
	return item, tx.Commit(ctx)
}

func (store *Admin) AccessCase(ctx context.Context, actorID, caseID string) (AdminAccessCase, error) {
	var item AdminAccessCase
	cases := table.AdminAccessCases.AS("c")
	users := table.Users.AS("u")
	err := jetQueryRow(ctx, store.pool, jetpg.SELECT(jetpg.CAST(cases.ID).AS_TEXT(), jetpg.CAST(cases.TargetUserID).AS_TEXT(),
		users.Username, cases.Reason, cases.CreatedAt, cases.ExpiresAt).
		FROM(cases.INNER_JOIN(users, users.ID.EQ(cases.TargetUserID))).WHERE(jetpg.AND(
		cases.ID.EQ(jetUUID(caseID)), cases.ActorID.EQ(jetUUID(actorID)),
		cases.ExpiresAt.GT(jetpg.RawTimestampz("clock_timestamp()")),
	))).Scan(&item.ID, &item.TargetUserID, &item.TargetUsername,
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
	cases := table.AdminAccessCases
	if err := jetQueryRow(ctx, tx, cases.SELECT(jetpg.CAST(cases.TargetUserID).AS_TEXT(), cases.Reason).
		WHERE(jetpg.AND(cases.ID.EQ(jetUUID(caseID)), cases.ActorID.EQ(jetUUID(actorID)))).
		FOR(jetpg.UPDATE())).Scan(&targetID, &reason); err != nil {
		return err
	}
	result, err := jetExec(ctx, tx, cases.UPDATE().SET(cases.ExpiresAt.SET(jetpg.RawTimestampz("clock_timestamp()"))).
		WHERE(jetpg.AND(cases.ID.EQ(jetUUID(caseID)), cases.ExpiresAt.GT(jetpg.RawTimestampz("clock_timestamp()")))))
	if err != nil {
		return err
	}
	if result.RowsAffected() > 0 {
		audit := table.AdminAudit
		detail, _ := json.Marshal(map[string]string{"caseId": caseID})
		if _, err := jetExec(ctx, tx, audit.INSERT(audit.ActorID, audit.TargetUserID, audit.Action, audit.Reason, audit.Detail).
			VALUES(jetUUID(actorID), jetUUID(targetID), jetpg.String("case.closed"), jetpg.String(reason), jetpg.Json(detail))); err != nil {
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
	var query jetpg.SelectStatement
	switch kind {
	case "posts":
		posts := table.FluoPosts.AS("p")
		media := table.FluoPostMedia.AS("m")
		condition := posts.AuthorID.EQ(jetUUID(targetID))
		if before != "" {
			condition = jetpg.AND(condition, posts.ID.LT(jetUUID(before)))
		}
		mediaJSON := jetpg.RawString(`COALESCE(jsonb_agg(jsonb_build_object('id', m.upload_id::text, 'kind', m.kind,
			'mimeType', m.mime_type, 'filename', '', 'size', m.size_bytes)
			ORDER BY m.position) FILTER (WHERE m.upload_id IS NOT NULL), '[]'::jsonb)`)
		query = jetpg.SELECT(jetpg.CAST(posts.ID).AS_TEXT(), posts.PlainText, posts.Visibility, posts.CreatedAt, mediaJSON).
			FROM(posts.LEFT_JOIN(media, media.PostID.EQ(posts.ID))).WHERE(condition).
			GROUP_BY(posts.ID, posts.PlainText, posts.Visibility, posts.CreatedAt).
			ORDER_BY(posts.ID.DESC()).LIMIT(51)
	case "messages":
		messages := table.LigoMessages.AS("m")
		conversations := table.LigoConversations.AS("c")
		media := table.LigoMessageMedia.AS("media")
		condition := jetpg.AND(messages.SenderID.EQ(jetUUID(targetID)), messages.DeletedAt.IS_NULL(), messages.SystemNotice.IS_FALSE())
		if before != "" {
			condition = jetpg.AND(condition, messages.ID.LT(jetUUID(before)))
		}
		mediaJSON := jetpg.RawString(`COALESCE(jsonb_agg(jsonb_build_object('id', media.upload_id::text, 'kind', media.kind,
			'mimeType', media.mime_type, 'filename', media.filename, 'size', media.size_bytes)
			ORDER BY media.position) FILTER (WHERE media.upload_id IS NOT NULL), '[]'::jsonb)`)
		query = jetpg.SELECT(jetpg.CAST(messages.ID).AS_TEXT(), messages.Body, conversations.Kind, messages.CreatedAt, mediaJSON).
			FROM(messages.INNER_JOIN(conversations, conversations.ID.EQ(messages.ConversationID)).
				LEFT_JOIN(media, media.MessageID.EQ(messages.ID))).WHERE(condition).
			GROUP_BY(messages.ID, conversations.Kind).
			ORDER_BY(messages.ID.DESC()).LIMIT(51)
	default:
		return AdminContentPage{}, errors.New("unsupported case content type")
	}
	rows, err := jetQuery(ctx, store.pool, query)
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
