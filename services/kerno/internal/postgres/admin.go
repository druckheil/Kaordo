// Package postgres implements Kerno's stores with Jet query builders and pgx transactions.
package postgres

// Aggregates administrative storage and activity metrics
import (
	"context"
	"encoding/json"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Admin struct {
	pool *pgxpool.Pool
}

func NewAdmin(pool *pgxpool.Pool) *Admin {
	return &Admin{pool: pool}
}

func (store *Admin) Summary(ctx context.Context) (admin.Summary, error) {
	var summary admin.Summary
	var breakdown []byte
	users := table.Users
	posts := table.FluoPosts
	messages := table.LigoMessages
	claims := table.NodoUploadClaims
	query := jetpg.SELECT(
		jetpg.COUNT(users.ID), jetpg.SELECT(jetpg.COUNT(posts.ID)).FROM(posts),
		jetpg.SELECT(jetpg.COUNT(messages.ID)).FROM(messages).WHERE(jetpg.AND(messages.DeletedAt.IS_NULL(), messages.SystemNotice.IS_FALSE())),
		jetpg.SELECT(jetpg.COUNT(claims.UploadID)).FROM(claims).WHERE(claims.RetiredAt.IS_NULL()),
		jetpg.RawInt(`COALESCE((SELECT sum(size_bytes) FROM (
			SELECT DISTINCT ON (upload_id) upload_id, size_bytes FROM (
				SELECT upload_id, size_bytes FROM fluo_post_media
				UNION ALL SELECT upload_id, size_bytes FROM ligo_message_media
				UNION ALL SELECT upload_id, size_bytes FROM fluo_profile_images
				UNION ALL SELECT upload_id, size_bytes FROM memoro_day_media
			) referenced ORDER BY upload_id
		) unique_media), 0)`),
		jetpg.RawInt("pg_database_size(current_database())"),
		jetpg.RawString(`COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', usage.kind,
			'objects', usage.objects, 'bytes', usage.bytes) ORDER BY usage.kind) FROM (
			SELECT kind, count(*) AS objects, sum(size_bytes) AS bytes FROM (
				SELECT DISTINCT ON (upload_id) upload_id, kind, size_bytes FROM (
					SELECT upload_id, kind, size_bytes FROM fluo_post_media
					UNION ALL SELECT upload_id, kind, size_bytes FROM ligo_message_media
					UNION ALL SELECT upload_id, 'image' AS kind, size_bytes FROM fluo_profile_images
					UNION ALL SELECT upload_id, 'file' AS kind, size_bytes FROM memoro_day_media
				) referenced ORDER BY upload_id
			) unique_media GROUP BY kind
		) usage), '[]'::jsonb)`),
	).FROM(users)
	err := jetQueryRow(ctx, store.pool, query).Scan(
		&summary.Users, &summary.Posts, &summary.Messages, &summary.Uploads, &summary.MediaBytes, &summary.DatabaseBytes, &breakdown)
	if err != nil {
		return summary, err
	}
	return summary, json.Unmarshal(breakdown, &summary.MediaByKind)
}
