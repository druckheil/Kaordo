package postgres

// Persists partial Fluo settings and builds notification preference guards
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func (store *Fluo) Settings(ctx context.Context, viewerID string) (fluo.Settings, error) {
	users := table.Users
	settings := table.FluoSettings
	defaults := fluo.DefaultSettings()
	return scanFluoSettings(jetQueryRow(ctx, store.pool, jetpg.SELECT(
		jetpg.COALESCE(settings.NotifyLikes, jetpg.String(defaults.Notifications.Likes)),
		jetpg.COALESCE(settings.NotifyDislikes, jetpg.String(defaults.Notifications.Dislikes)),
		jetpg.COALESCE(settings.NotifyReplies, jetpg.String(defaults.Notifications.Replies)),
		jetpg.COALESCE(settings.NotifyFollows, jetpg.String(defaults.Notifications.Follows)),
		jetpg.COALESCE(settings.NotifyUnfollows, jetpg.String(defaults.Notifications.Unfollows)),
		jetpg.COALESCE(settings.NotifyQuotes, jetpg.String(defaults.Notifications.Quotes)),
		jetpg.COALESCE(settings.AccountVisibility, jetpg.String(defaults.Privacy.AccountVisibility)),
		jetpg.COALESCE(settings.ShowLikes, jetpg.Bool(defaults.Privacy.ShowLikes)),
		jetpg.COALESCE(settings.PresenceVisibility, jetpg.String(defaults.Privacy.PresenceVisibility)),
	).FROM(users.LEFT_JOIN(settings, settings.UserID.EQ(users.ID))).WHERE(users.ID.EQ(jetUUID(viewerID)))))
}

func (store *Fluo) UpdateSettings(ctx context.Context, viewerID string, patch fluo.SettingsPatch) (fluo.Settings, error) {
	if err := patch.Validate(); err != nil {
		return fluo.Settings{}, err
	}
	settings := table.FluoSettings
	notifications := fluo.NotificationPreferencesPatch{}
	privacy := fluo.PrivacySettingsPatch{}
	if patch.Notifications != nil {
		notifications = *patch.Notifications
	}
	if patch.Privacy != nil {
		privacy = *patch.Privacy
	}
	columns := jetpg.ColumnList{settings.UserID}
	values := []any{jetUUID(viewerID)}
	updates := make([]jetpg.ColumnAssigment, 0, 8)
	for _, field := range []struct {
		column jetpg.ColumnString
		value  *string
	}{
		{settings.NotifyLikes, notifications.Likes}, {settings.NotifyDislikes, notifications.Dislikes},
		{settings.NotifyReplies, notifications.Replies}, {settings.NotifyFollows, notifications.Follows},
		{settings.NotifyUnfollows, notifications.Unfollows}, {settings.NotifyQuotes, notifications.Quotes},
		{settings.AccountVisibility, privacy.AccountVisibility},
		{settings.PresenceVisibility, privacy.PresenceVisibility},
	} {
		if field.value == nil {
			continue
		}
		value := jetpg.String(*field.value)
		columns = append(columns, field.column)
		values = append(values, value)
		updates = append(updates, field.column.SET(value))
	}
	if privacy.ShowLikes != nil {
		value := jetpg.Bool(*privacy.ShowLikes)
		columns = append(columns, settings.ShowLikes)
		values = append(values, value)
		updates = append(updates, settings.ShowLikes.SET(value))
	}
	// PostgreSQL defaults fill absent columns on insert; conflict updates touch only the supplied fields.
	return scanFluoSettings(jetQueryRow(ctx, store.pool, settings.INSERT(columns).VALUES(values[0], values[1:]...).
		ON_CONFLICT(settings.UserID).DO_UPDATE(jetpg.SET(updates...)).RETURNING(
		settings.NotifyLikes, settings.NotifyDislikes, settings.NotifyReplies,
		settings.NotifyFollows, settings.NotifyUnfollows, settings.NotifyQuotes,
		settings.AccountVisibility, settings.ShowLikes, settings.PresenceVisibility,
	)))
}

func scanFluoSettings(row scanner) (fluo.Settings, error) {
	var settings fluo.Settings
	err := row.Scan(
		&settings.Notifications.Likes, &settings.Notifications.Dislikes, &settings.Notifications.Replies,
		&settings.Notifications.Follows, &settings.Notifications.Unfollows, &settings.Notifications.Quotes,
		&settings.Privacy.AccountVisibility, &settings.Privacy.ShowLikes,
		&settings.Privacy.PresenceVisibility,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return fluo.Settings{}, fluo.ErrNotFound
	}
	return settings, err
}

func notificationPreferenceAllows(recipientID jetpg.StringExpression, actorID, kind string) jetpg.BoolExpression {
	settings := table.FluoSettings.AS("recipient_preferences")
	var column jetpg.ColumnString
	var defaultPolicy string
	defaults := fluo.DefaultSettings().Notifications
	switch kind {
	case fluo.NotificationLike:
		column, defaultPolicy = settings.NotifyLikes, defaults.Likes
	case fluo.NotificationDislike:
		column, defaultPolicy = settings.NotifyDislikes, defaults.Dislikes
	case fluo.NotificationReply:
		column, defaultPolicy = settings.NotifyReplies, defaults.Replies
	case fluo.NotificationQuote:
		column, defaultPolicy = settings.NotifyQuotes, defaults.Quotes
	case fluo.NotificationFollow:
		column, defaultPolicy = settings.NotifyFollows, defaults.Follows
	case fluo.NotificationUnfollow:
		column, defaultPolicy = settings.NotifyUnfollows, defaults.Unfollows
	default:
		return jetpg.Bool(false)
	}
	policy := jetpg.StringExp(jetpg.COALESCE(
		jetpg.SELECT(column).FROM(settings).WHERE(settings.UserID.EQ(recipientID)), jetpg.String(defaultPolicy),
	))
	follows := table.FluoFollows.AS("recipient_follows")
	// A simple CASE evaluates the stored/default policy once before consulting the follow relation.
	return jetpg.BoolExp(jetpg.CASE(policy).
		WHEN(jetpg.String(fluo.NotifyAll)).THEN(jetpg.Bool(true)).
		WHEN(jetpg.String(fluo.NotifyFollowing)).THEN(jetpg.EXISTS(
		jetpg.SELECT(follows.FollowedID).FROM(follows).WHERE(jetpg.AND(
			follows.FollowerID.EQ(recipientID), follows.FollowedID.EQ(jetUUID(actorID)),
		)),
	)).ELSE(jetpg.Bool(false)))
}

func likesIdentifiable(actorID jetpg.StringExpression) jetpg.BoolExpression {
	settings := table.FluoSettings.AS("actor_preferences")
	return jetpg.NOT(jetpg.EXISTS(jetpg.SELECT(settings.UserID).FROM(settings).WHERE(jetpg.AND(
		settings.UserID.EQ(actorID), settings.ShowLikes.EQ(jetpg.Bool(false)),
	))))
}

var _ fluo.SettingsStore = (*Fluo)(nil)
