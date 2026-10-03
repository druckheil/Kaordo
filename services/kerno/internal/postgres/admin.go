package postgres

// Aggregates administrative storage and activity metrics
import (
	"context"
	"encoding/json"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrAdminTarget = errors.New("admin target is unavailable")
var ErrAccessLimit = errors.New("too many recent access cases")

type Admin struct {
	pool *pgxpool.Pool
}

func NewAdmin(pool *pgxpool.Pool) *Admin {
	return &Admin{pool: pool}
}

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
