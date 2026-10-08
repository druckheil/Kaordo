package postgres

// Reads accessible Fluo notifications and persists recipient-owned read state
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func notificationAccessible(viewerID string, notifications *table.FluoNotificationsTable) jetpg.BoolExpression {
	post := table.FluoPosts.AS("p")
	subject := table.FluoPosts.AS("subject")
	identityVisible := jetpg.OR(
		notifications.Kind.NOT_EQ(jetpg.String(fluo.NotificationLike)), likesIdentifiable(notifications.ActorID),
	)
	followActivity := notifications.Kind.IN(jetpg.String(fluo.NotificationFollow), jetpg.String(fluo.NotificationUnfollow))
	postsAccessible := jetpg.EXISTS(jetpg.SELECT(post.ID).
		FROM(post.INNER_JOIN(subject, subject.ID.EQ(notifications.SubjectPostID))).
		WHERE(jetpg.AND(
			post.ID.EQ(notifications.PostID), postAccessibleCondition(viewerID, post), postTreeAccessible(viewerID, subject),
		)))
	return jetpg.AND(
		notifications.RecipientID.EQ(jetUUID(viewerID)), identityVisible, jetpg.OR(followActivity, postsAccessible),
	)
}

func notificationSummary(ctx context.Context, executor jetExecutor, viewerID string) (fluo.NotificationSummary, error) {
	notifications := table.FluoNotifications
	var summary fluo.NotificationSummary
	err := jetQueryRow(ctx, executor, jetpg.SELECT(jetpg.COUNT(notifications.ID)).FROM(notifications).
		WHERE(jetpg.AND(notifications.ReadAt.IS_NULL(), notificationAccessible(viewerID, notifications)))).
		Scan(&summary.UnreadCount)
	return summary, err
}

func (store *Fluo) NotificationSummary(ctx context.Context, viewerID string) (fluo.NotificationSummary, error) {
	return notificationSummary(ctx, store.pool, viewerID)
}

func (store *Fluo) Notifications(ctx context.Context, options fluo.NotificationOptions) (fluo.NotificationPage, error) {
	// The list, badge count, and bulk-read boundary describe the same snapshot.
	tx, err := store.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fluo.NotificationPage{}, err
	}
	defer tx.Rollback(ctx)
	summary, err := notificationSummary(ctx, tx, options.ViewerID)
	if err != nil {
		return fluo.NotificationPage{}, err
	}

	notifications := table.FluoNotifications.AS("n")
	actor := table.Users.AS("actor")
	post := table.FluoPosts.AS("preview")
	condition := notificationAccessible(options.ViewerID, notifications)
	if options.Cursor != nil {
		condition = jetpg.AND(condition, fluoBeforeCursor(notifications.CreatedAt, notifications.ID, *options.Cursor, false))
	}
	rows, err := jetQuery(ctx, tx, jetpg.SELECT(
		jetpg.CAST(notifications.ID).AS_TEXT(), notifications.Kind,
		fluoAuthorColumns(options.ViewerID, actor),
		jetpg.CAST(post.ID).AS_TEXT(), jetpg.LEFT(post.PlainText, jetpg.Int(280)), postMediaJSON(post),
		notifications.CreatedAt, notifications.ReadAt,
	).FROM(notifications.INNER_JOIN(actor, actor.ID.EQ(notifications.ActorID)).
		LEFT_JOIN(post, post.ID.EQ(notifications.PostID))).WHERE(condition).
		ORDER_BY(notifications.CreatedAt.DESC(), notifications.ID.DESC()).LIMIT(int64(options.Limit+1)))
	if err != nil {
		return fluo.NotificationPage{}, err
	}
	page, err := scanNotificationPage(rows, options.Limit)
	rows.Close()
	if err != nil {
		return fluo.NotificationPage{}, err
	}
	page.UnreadCount = summary.UnreadCount
	if err := tx.Commit(ctx); err != nil {
		return fluo.NotificationPage{}, err
	}
	return page, nil
}

func scanNotificationPage(rows pgx.Rows, limit int) (fluo.NotificationPage, error) {
	page := fluo.NotificationPage{Items: make([]fluo.Notification, 0, limit)}
	for rows.Next() {
		notification, err := scanNotification(rows)
		if err != nil {
			return fluo.NotificationPage{}, err
		}
		page.Items = append(page.Items, notification)
	}
	if err := rows.Err(); err != nil {
		return fluo.NotificationPage{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		last := page.Items[len(page.Items)-1]
		cursor := (fluo.Cursor{CreatedAt: last.CreatedAt, ID: last.ID}).Encode()
		page.NextCursor = &cursor
	}
	if len(page.Items) > 0 {
		first := page.Items[0]
		through := (fluo.Cursor{CreatedAt: first.CreatedAt, ID: first.ID}).Encode()
		page.Through = &through
	}
	return page, nil
}

func scanNotification(row scanner) (fluo.Notification, error) {
	var notification fluo.Notification
	var postID, postText *string
	var mediaJSON, avatarJSON []byte
	if err := row.Scan(
		&notification.ID, &notification.Kind,
		&notification.Actor.ID, &notification.Actor.Username, &notification.Actor.DisplayName, &notification.Actor.Following,
		&avatarJSON, &notification.Actor.Verified,
		&postID, &postText, &mediaJSON, &notification.CreatedAt, &notification.ReadAt,
	); err != nil {
		return fluo.Notification{}, err
	}
	if err := json.Unmarshal(avatarJSON, &notification.Actor.Avatar); err != nil {
		return fluo.Notification{}, err
	}
	if postID == nil || postText == nil {
		return notification, nil
	}
	notification.Post = &fluo.NotificationPost{ID: *postID, Text: *postText}
	if err := json.Unmarshal(mediaJSON, &notification.Post.Media); err != nil {
		return fluo.Notification{}, fmt.Errorf("decode notification media: %w", err)
	}
	return notification, nil
}

func (store *Fluo) ReadNotification(ctx context.Context, viewerID, id string) (fluo.NotificationReadState, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return fluo.NotificationReadState{}, err
	}
	defer tx.Rollback(ctx)

	notifications := table.FluoNotifications
	readAt := jetpg.RawTimestampz("COALESCE(read_at, clock_timestamp())")
	var state fluo.NotificationReadState
	err = jetQueryRow(ctx, tx, notifications.UPDATE(notifications.ReadAt).SET(readAt).
		WHERE(jetpg.AND(notifications.ID.EQ(jetUUID(id)), notificationAccessible(viewerID, notifications))).
		RETURNING(jetpg.CAST(notifications.ID).AS_TEXT(), notifications.ReadAt)).Scan(&state.ID, &state.ReadAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return fluo.NotificationReadState{}, fluo.ErrNotFound
	}
	if err != nil {
		return fluo.NotificationReadState{}, err
	}
	summary, err := notificationSummary(ctx, tx, viewerID)
	if err != nil {
		return fluo.NotificationReadState{}, err
	}
	state.UnreadCount = summary.UnreadCount
	if err := tx.Commit(ctx); err != nil {
		return fluo.NotificationReadState{}, err
	}
	return state, nil
}

func (store *Fluo) ReadNotificationsThrough(ctx context.Context, viewerID string, through fluo.Cursor) (fluo.NotificationSummary, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return fluo.NotificationSummary{}, err
	}
	defer tx.Rollback(ctx)
	notifications := table.FluoNotifications
	if _, err := jetExec(ctx, tx, notifications.UPDATE(notifications.ReadAt).SET(jetpg.RawTimestampz("clock_timestamp()")).
		WHERE(jetpg.AND(
			notifications.ReadAt.IS_NULL(), notificationAccessible(viewerID, notifications),
			fluoBeforeCursor(notifications.CreatedAt, notifications.ID, through, true),
		))); err != nil {
		return fluo.NotificationSummary{}, err
	}
	summary, err := notificationSummary(ctx, tx, viewerID)
	if err != nil {
		return fluo.NotificationSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return fluo.NotificationSummary{}, err
	}
	return summary, nil
}

var _ fluo.NotificationStore = (*Fluo)(nil)
