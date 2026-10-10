package postgres

// Projects consistent Fluo author identity and profile images without exposing account settings
import (
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
)

func fluoDisplayName(user *table.UsersTable) jetpg.StringExpression {
	profile := table.FluoProfiles.AS("author_profile")
	// Jet function arguments need explicit parentheses around scalar subqueries.
	return jetpg.StringExp(jetpg.COALESCE(jetpg.NULLIF(
		jetpg.WRAP(jetpg.SELECT(profile.Nickname).FROM(profile).WHERE(profile.UserID.EQ(user.ID))), jetpg.String(""),
	), user.DisplayName))
}

func fluoVerified(user *table.UsersTable) jetpg.BoolExpression {
	profile := table.FluoProfiles.AS("verified_profile")
	return jetpg.BoolExp(jetpg.COALESCE(
		jetpg.WRAP(jetpg.SELECT(profile.Verified).FROM(profile).WHERE(profile.UserID.EQ(user.ID))), jetpg.Bool(false),
	))
}

func fluoImageJSON(userID jetpg.StringExpression, slot string) jetpg.StringExpression {
	image := table.FluoProfileImages.AS("profile_image")
	metadata := jetpg.CustomExpression(jetpg.Token("jsonb_build_object('id',"), jetpg.CAST(image.UploadID).AS_TEXT(),
		jetpg.Token(",'kind','image','mimeType',"), image.MimeType,
		jetpg.Token(",'width',"), image.Width, jetpg.Token(",'height',"), image.Height,
		jetpg.Token(",'size',"), image.SizeBytes, jetpg.Token(",'altText','','url','')"))
	return jetpg.StringExp(jetpg.COALESCE(jetpg.WRAP(jetpg.SELECT(metadata).FROM(image).WHERE(jetpg.AND(
		image.UserID.EQ(userID), image.Slot.EQ(jetpg.String(slot)),
	))), jetpg.RawString("'null'::jsonb")))
}

func fluoFollowing(followerID, followedID jetpg.StringExpression) jetpg.BoolExpression {
	follows := table.FluoFollows.AS("author_follow")
	return jetpg.EXISTS(jetpg.SELECT(follows.FollowerID).FROM(follows).WHERE(jetpg.AND(
		follows.FollowerID.EQ(followerID), follows.FollowedID.EQ(followedID),
	)))
}

func fluoAuthorColumns(viewerID string, user *table.UsersTable) jetpg.ProjectionList {
	return jetpg.ProjectionList{
		jetpg.CAST(user.ID).AS_TEXT(), user.Username, fluoDisplayName(user),
		fluoFollowing(jetUUID(viewerID), user.ID), fluoImageJSON(user.ID, "avatar"), fluoVerified(user),
	}
}
