package postgres

// Records Fluo activity with a shared hourly cooldown inside each originating transaction
import (
	"context"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func recordRelationNotification(ctx context.Context, tx pgx.Tx, actorID, postID string, parentID, quoteID *string) error {
	switch {
	case parentID != nil:
		return recordPostNotification(ctx, tx, actorID, postID, fluo.NotificationReply)
	case quoteID != nil:
		return recordPostNotification(ctx, tx, actorID, postID, fluo.NotificationQuote)
	default:
		return nil
	}
}

func recordPostNotification(ctx context.Context, tx pgx.Tx, actorID, postID, kind string) error {
	post := table.FluoPosts.AS("activity")
	subject := table.FluoPosts.AS("subject")
	reference := post.ID
	switch kind {
	case fluo.NotificationReply:
		reference = post.ParentID
	case fluo.NotificationQuote:
		reference = post.QuoteID
	}
	notifications := table.FluoNotifications
	identityVisible := jetpg.Bool(true)
	if kind == fluo.NotificationLike {
		identityVisible = likesIdentifiable(jetUUID(actorID))
	}
	_, err := jetExec(ctx, tx, notifications.INSERT(
		notifications.RecipientID, notifications.ActorID, notifications.Kind, notifications.PostID, notifications.SubjectPostID,
	).QUERY(jetpg.SELECT(subject.AuthorID, jetUUID(actorID), jetpg.String(kind), post.ID, subject.ID).
		FROM(post.INNER_JOIN(subject, subject.ID.EQ(reference))).
		WHERE(jetpg.AND(
			post.ID.EQ(jetUUID(postID)), post.Visibility.EQ(jetpg.String(fluo.VisibilityPublic)),
			subject.AuthorID.NOT_EQ(jetUUID(actorID)),
			identityVisible, notificationPreferenceAllows(subject.AuthorID, actorID, kind),
			notificationCooldownElapsed(subject.AuthorID, actorID, kind, post.ID),
		))))
	return err
}

func recordFollowNotification(ctx context.Context, tx pgx.Tx, actorID, targetID, kind string) error {
	notifications := table.FluoNotifications
	_, err := jetExec(ctx, tx, notifications.INSERT(
		notifications.RecipientID, notifications.ActorID, notifications.Kind,
	).QUERY(jetpg.SELECT(jetUUID(targetID), jetUUID(actorID), jetpg.String(kind)).
		WHERE(jetpg.AND(
			notificationPreferenceAllows(jetUUID(targetID), actorID, kind),
			notificationCooldownElapsed(jetUUID(targetID), actorID, kind, nil),
		))))
	return err
}

func notificationCooldownElapsed(recipientID jetpg.StringExpression, actorID, kind string, postID jetpg.StringExpression) jetpg.BoolExpression {
	previous := table.FluoNotifications.AS("previous_activity")
	samePost := previous.PostID.IS_NULL()
	if postID != nil {
		samePost = previous.PostID.EQ(postID)
	}
	// The originating relation/post write already serializes repeats; this statement sees the last committed event.
	return jetpg.NOT(jetpg.EXISTS(jetpg.SELECT(previous.ID).FROM(previous).WHERE(jetpg.AND(
		previous.RecipientID.EQ(recipientID), previous.ActorID.EQ(jetUUID(actorID)),
		previous.Kind.EQ(jetpg.String(kind)), samePost,
		previous.CreatedAt.GT(jetpg.RawTimestampz("statement_timestamp() - interval '1 hour'")),
	))))
}
