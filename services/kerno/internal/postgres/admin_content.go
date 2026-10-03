package postgres

// Reads content authorized by an administrator access case
import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

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
	query, err := adminContentQuery(targetID, kind, before)
	if err != nil {
		return AdminContentPage{}, err
	}
	rows, err := jetQuery(ctx, store.pool, query)
	if err != nil {
		return AdminContentPage{}, err
	}
	defer rows.Close()
	return scanAdminContentPage(rows)
}

func adminContentQuery(targetID, kind, before string) (jetpg.SelectStatement, error) {
	switch kind {
	case "posts":
		return postContentQuery(targetID, before), nil
	case "messages":
		return messageContentQuery(targetID, before), nil
	default:
		return nil, errors.New("unsupported case content type")
	}
}

func postContentQuery(targetID, before string) jetpg.SelectStatement {
	posts := table.FluoPosts.AS("p")
	media := table.FluoPostMedia.AS("m")
	condition := posts.AuthorID.EQ(jetUUID(targetID))
	if before != "" {
		condition = jetpg.AND(condition, posts.ID.LT(jetUUID(before)))
	}
	mediaJSON := jetpg.RawString(`COALESCE(jsonb_agg(jsonb_build_object('id', m.upload_id::text, 'kind', m.kind,
		'mimeType', m.mime_type, 'filename', '', 'size', m.size_bytes)
		ORDER BY m.position) FILTER (WHERE m.upload_id IS NOT NULL), '[]'::jsonb)`)
	return jetpg.SELECT(jetpg.CAST(posts.ID).AS_TEXT(), posts.PlainText, posts.Visibility, posts.CreatedAt, mediaJSON).
		FROM(posts.LEFT_JOIN(media, media.PostID.EQ(posts.ID))).WHERE(condition).
		GROUP_BY(posts.ID, posts.PlainText, posts.Visibility, posts.CreatedAt).
		ORDER_BY(posts.ID.DESC()).LIMIT(51)
}

func messageContentQuery(targetID, before string) jetpg.SelectStatement {
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
	return jetpg.SELECT(jetpg.CAST(messages.ID).AS_TEXT(), messages.Body, conversations.Kind, messages.CreatedAt, mediaJSON).
		FROM(messages.INNER_JOIN(conversations, conversations.ID.EQ(messages.ConversationID)).
			LEFT_JOIN(media, media.MessageID.EQ(messages.ID))).WHERE(condition).
		GROUP_BY(messages.ID, conversations.Kind).
		ORDER_BY(messages.ID.DESC()).LIMIT(51)
}

func scanAdminContentPage(rows pgx.Rows) (AdminContentPage, error) {
	page := AdminContentPage{Items: make([]AdminContent, 0)}
	for rows.Next() {
		item, err := scanAdminContent(rows)
		if err != nil {
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

func scanAdminContent(row pgx.Row) (AdminContent, error) {
	var item AdminContent
	var media []byte
	if err := row.Scan(&item.ID, &item.Text, &item.Context, &item.CreatedAt, &media); err != nil {
		return AdminContent{}, err
	}
	if err := json.Unmarshal(media, &item.Media); err != nil {
		return AdminContent{}, err
	}
	return item, nil
}
