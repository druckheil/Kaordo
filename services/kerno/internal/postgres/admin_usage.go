package postgres

// Measures each account's media and encrypted rows, the databases and their largest tables
import (
	"cmp"
	"context"
	"slices"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

// Media sizes come from the rows that reference each upload; row sizes are PostgreSQL's
// stored sizes, compressed where TOAST compresses them. "Week" sums what was added in 7 days.
const userUsageQuery = `
WITH post_media AS (
    SELECT p.author_id AS user_id, sum(m.size_bytes) AS bytes,
        sum(m.size_bytes) FILTER (WHERE p.created_at > now() - interval '7 days') AS week
    FROM fluo_post_media m JOIN fluo_posts p ON p.id = m.post_id GROUP BY p.author_id
), message_media AS (
    SELECT msg.sender_id AS user_id,
        sum(mm.size_bytes) FILTER (WHERE c.kind <> 'channel') AS messages,
        sum(mm.size_bytes) FILTER (WHERE c.kind = 'channel') AS channels,
        sum(mm.size_bytes) FILTER (WHERE msg.created_at > now() - interval '7 days') AS week
    FROM ligo_message_media mm
    JOIN ligo_messages msg ON msg.id = mm.message_id
    JOIN ligo_conversations c ON c.id = msg.conversation_id
    WHERE msg.deleted_at IS NULL GROUP BY msg.sender_id
), profile_media AS (
    SELECT user_id, sum(size_bytes) AS bytes FROM fluo_profile_images GROUP BY user_id
), journal_media AS (
    SELECT dm.user_id, sum(dm.size_bytes) AS bytes,
        sum(dm.size_bytes) FILTER (WHERE c.claimed_at > now() - interval '7 days') AS week
    FROM memoro_day_media dm JOIN nodo_upload_claims c ON c.upload_id = dm.upload_id GROUP BY dm.user_id
), post_rows AS (
    SELECT author_id AS user_id, sum(pg_column_size(p.*)) AS bytes,
        sum(pg_column_size(p.*)) FILTER (WHERE created_at > now() - interval '7 days') AS week
    FROM fluo_posts p GROUP BY author_id
), message_rows AS (
    SELECT m.sender_id AS user_id,
        sum(pg_column_size(m.*)) FILTER (WHERE c.kind <> 'channel') AS messages,
        sum(pg_column_size(m.*)) FILTER (WHERE c.kind = 'channel') AS channels,
        sum(pg_column_size(m.*)) FILTER (WHERE m.created_at > now() - interval '7 days') AS week
    FROM ligo_messages m JOIN ligo_conversations c ON c.id = m.conversation_id
    WHERE NOT m.system_notice GROUP BY m.sender_id
), journal_rows AS (
    SELECT user_id, sum(pg_column_size(d.*)) AS bytes,
        sum(pg_column_size(d.*)) FILTER (WHERE updated_at > now() - interval '7 days') AS week
    FROM memoro_days d GROUP BY user_id
), private_rows AS (
    SELECT user_id, sum(pg_column_size(r.*)) AS bytes FROM private_records r GROUP BY user_id
)
SELECT u.id::text, u.username, u.display_name,
    coalesce(pm.bytes, 0)::bigint, coalesce(mm.messages, 0)::bigint, coalesce(mm.channels, 0)::bigint,
    coalesce(fm.bytes, 0)::bigint, coalesce(jm.bytes, 0)::bigint,
    coalesce(pr.bytes, 0)::bigint, coalesce(mr.messages, 0)::bigint, coalesce(mr.channels, 0)::bigint,
    coalesce(jr.bytes, 0)::bigint, coalesce(vr.bytes, 0)::bigint,
    (coalesce(pm.week, 0) + coalesce(mm.week, 0) + coalesce(jm.week, 0)
        + coalesce(pr.week, 0) + coalesce(mr.week, 0) + coalesce(jr.week, 0))::bigint
FROM users u
LEFT JOIN post_media pm ON pm.user_id = u.id
LEFT JOIN message_media mm ON mm.user_id = u.id
LEFT JOIN profile_media fm ON fm.user_id = u.id
LEFT JOIN journal_media jm ON jm.user_id = u.id
LEFT JOIN post_rows pr ON pr.user_id = u.id
LEFT JOIN message_rows mr ON mr.user_id = u.id
LEFT JOIN journal_rows jr ON jr.user_id = u.id
LEFT JOIN private_rows vr ON vr.user_id = u.id`

const databaseUsageQuery = `
SELECT datname, CASE WHEN has_database_privilege(datname, 'CONNECT') THEN pg_database_size(datname) ELSE 0 END
FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY 2 DESC, 1`

const tableUsageQuery = `
SELECT c.relname, pg_total_relation_size(c.oid), coalesce(s.n_live_tup, 0), coalesce(s.n_dead_tup, 0)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind = 'r' AND n.nspname = 'public'
ORDER BY 2 DESC, 1 LIMIT 12`

const referencedMediaQuery = `
SELECT count(*), coalesce(sum(size_bytes), 0)::bigint FROM (
    SELECT DISTINCT ON (upload_id) upload_id, size_bytes FROM (
        SELECT upload_id, size_bytes FROM fluo_post_media
        UNION ALL SELECT upload_id, size_bytes FROM ligo_message_media
        UNION ALL SELECT upload_id, size_bytes FROM fluo_profile_images
        UNION ALL SELECT upload_id, size_bytes FROM memoro_day_media
    ) media ORDER BY upload_id
) referenced`

// DataUsage reads every account's share and the database's own footprint in one snapshot.
func (store *Admin) DataUsage(ctx context.Context) (admin.DataUsage, error) {
	usage := admin.DataUsage{Users: []admin.UserData{}, Databases: []admin.DatabaseSize{}, Tables: []admin.TableSize{}}
	tx, err := store.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return usage, err
	}
	defer tx.Rollback(ctx)
	rows, err := jetQuery(ctx, tx, jetpg.RawStatement(userUsageQuery))
	if err != nil {
		return usage, err
	}
	for rows.Next() {
		var user admin.UserData
		if err := rows.Scan(&user.ID, &user.Username, &user.DisplayName,
			&user.Media.Posts, &user.Media.Messages, &user.Media.Channels, &user.Media.Profile, &user.Media.Journal,
			&user.Records.Posts, &user.Records.Messages, &user.Records.Channels, &user.Records.Journal, &user.Records.Learning,
			&user.AddedWeek); err != nil {
			rows.Close()
			return usage, err
		}
		user.Total = sumApps(user.Media) + sumApps(user.Records)
		usage.Users = append(usage.Users, user)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return usage, err
	}
	sortUsers(usage.Users)

	rows, err = jetQuery(ctx, tx, jetpg.RawStatement(databaseUsageQuery))
	if err != nil {
		return usage, err
	}
	for rows.Next() {
		var database admin.DatabaseSize
		if err := rows.Scan(&database.Name, &database.Bytes); err != nil {
			rows.Close()
			return usage, err
		}
		usage.Databases = append(usage.Databases, database)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return usage, err
	}

	rows, err = jetQuery(ctx, tx, jetpg.RawStatement(tableUsageQuery))
	if err != nil {
		return usage, err
	}
	for rows.Next() {
		var table admin.TableSize
		if err := rows.Scan(&table.Name, &table.Bytes, &table.Rows, &table.DeadRows); err != nil {
			rows.Close()
			return usage, err
		}
		usage.Tables = append(usage.Tables, table)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return usage, err
	}

	err = jetQueryRow(ctx, tx, jetpg.RawStatement(referencedMediaQuery)).Scan(&usage.ReferencedUploads, &usage.ReferencedMedia)
	return usage, err
}

func sumApps(bytes admin.AppBytes) int64 {
	return bytes.Posts + bytes.Messages + bytes.Channels + bytes.Profile + bytes.Journal + bytes.Learning
}

// sortUsers puts the largest accounts first, then names in order for stable output
func sortUsers(users []admin.UserData) {
	slices.SortFunc(users, func(a, b admin.UserData) int {
		if a.Total != b.Total {
			return cmp.Compare(b.Total, a.Total)
		}
		return strings.Compare(a.Username, b.Username)
	})
}
