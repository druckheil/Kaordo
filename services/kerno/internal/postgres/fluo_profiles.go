package postgres

// Reads public profile details while enforcing presence and account visibility in SQL
import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func fluoProfileQuery(viewerID string) jetpg.SelectStatement {
	user := table.Users.AS("profile_user")
	profile := table.FluoProfiles.AS("profile")
	settings := table.FluoSettings.AS("profile_settings")
	visibility := jetpg.StringExp(jetpg.COALESCE(settings.AccountVisibility, jetpg.String(fluo.VisibilityPublic)))
	owner := user.ID.EQ(jetUUID(viewerID))
	followedBy := fluoFollowing(user.ID, jetUUID(viewerID))
	canView := jetpg.OR(owner, visibility.EQ(jetpg.String(fluo.VisibilityPublic)), followedBy)
	status := jetpg.StringExp(jetpg.COALESCE(profile.Status, jetpg.String(fluo.StatusOnline)))
	policy := jetpg.StringExp(jetpg.COALESCE(settings.PresenceVisibility, jetpg.String(fluo.PresenceAll)))
	return jetpg.SELECT(
		fluoAuthorColumns(viewerID, user),
		jetpg.COALESCE(profile.Bio, jetpg.String("")), jetpg.CAST(profile.BirthDate).AS_TEXT(),
		jetpg.COALESCE(profile.Location, jetpg.String("")), jetpg.COALESCE(profile.Website, jetpg.String("")),
		jetpg.COALESCE(profile.Pronouns, jetpg.String("")), fluoImageJSON(user.ID, "banner"), user.CreatedAt,
		fluoConnectionCount(user.ID, "followers"), fluoConnectionCount(user.ID, "following"),
		followedBy, visibility, canView,
		fluoPresence(viewerID, user.ID, profile, settings),
		jetpg.CASE().WHEN(jetpg.AND(owner, policy.NOT_EQ(jetpg.String(fluo.PresenceOff)))).THEN(status).ELSE(jetpg.NULL),
	).FROM(user.LEFT_JOIN(profile, profile.UserID.EQ(user.ID)).LEFT_JOIN(settings, settings.UserID.EQ(user.ID)))
}

func fluoPresence(viewerID string, userID jetpg.StringExpression, profile *table.FluoProfilesTable, settings *table.FluoSettingsTable) jetpg.Expression {
	policy := jetpg.StringExp(jetpg.COALESCE(settings.PresenceVisibility, jetpg.String(fluo.PresenceAll)))
	status := jetpg.StringExp(jetpg.COALESCE(profile.Status, jetpg.String(fluo.StatusOnline)))
	viewer := jetUUID(viewerID)
	visible := jetpg.AND(policy.NOT_EQ(jetpg.String(fluo.PresenceOff)), status.NOT_EQ(jetpg.String(fluo.StatusInvisible)), jetpg.OR(
		userID.EQ(viewer), policy.EQ(jetpg.String(fluo.PresenceAll)),
		jetpg.AND(policy.EQ(jetpg.String(fluo.PresenceFriends)), fluoFollowing(viewer, userID), fluoFollowing(userID, viewer)),
	))
	return jetpg.CASE().WHEN(jetpg.NOT(visible)).THEN(jetpg.NULL).
		WHEN(profile.LastActiveAt.GT(jetpg.RawTimestampz("now() - #lifetime * interval '1 second'",
			jetpg.RawArgs{"#lifetime": fluo.PresenceLifetime.Seconds()}))).THEN(status).
		ELSE(jetpg.String("offline"))
}

func (store *Fluo) Profile(ctx context.Context, viewerID, username string) (fluo.Profile, error) {
	user := table.Users.AS("profile_user")
	return scanFluoProfile(jetQueryRow(ctx, store.pool, fluoProfileQuery(viewerID).WHERE(jetpg.AND(
		jetpg.LOWER(user.Username).EQ(jetpg.LOWER(jetpg.String(username))), user.DisabledAt.IS_NULL(),
	))))
}

func ownedFluoProfile(ctx context.Context, executor jetExecutor, userID string) (fluo.Profile, error) {
	user := table.Users.AS("profile_user")
	return scanFluoProfile(jetQueryRow(ctx, executor, fluoProfileQuery(userID).WHERE(jetpg.AND(
		user.ID.EQ(jetUUID(userID)), user.DisabledAt.IS_NULL(),
	))))
}

func scanFluoProfile(row scanner) (fluo.Profile, error) {
	var profile fluo.Profile
	var avatar, banner []byte
	var status sql.NullString
	err := row.Scan(
		&profile.ID, &profile.Username, &profile.DisplayName, &profile.Following, &avatar, &profile.Verified,
		&profile.Bio, &profile.BirthDate, &profile.Location, &profile.Website, &profile.Pronouns,
		&banner, &profile.CreatedAt, &profile.FollowersCount, &profile.FollowingCount, &profile.FollowedBy,
		&profile.AccountVisibility, &profile.CanViewPosts, &profile.Presence, &status,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return profile, fluo.ErrNotFound
	}
	if err != nil {
		return profile, err
	}
	if err := json.Unmarshal(avatar, &profile.Avatar); err != nil {
		return profile, err
	}
	if err := json.Unmarshal(banner, &profile.Banner); err != nil {
		return profile, err
	}
	profile.Status = status.String
	return profile, nil
}

var _ fluo.ProfileStore = (*Fluo)(nil)
