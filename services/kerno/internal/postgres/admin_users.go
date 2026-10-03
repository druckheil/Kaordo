package postgres

// Lists users and applies administrator account changes
import (
	"context"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

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
	literal := escapeLikeLiteral(search)
	query, u := adminUserQuery()
	condition := jetpg.Bool(true)
	if literal != "" {
		pattern := jetpg.LOWER(jetpg.String("%" + literal + "%"))
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
