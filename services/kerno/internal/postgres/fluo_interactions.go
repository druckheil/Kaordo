package postgres

// Manages Fluo media references, saves, reactions, and follows
import (
	"context"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
)

func (store *Fluo) MediaReferenced(ctx context.Context, id string) (bool, error) {
	var referenced bool
	postMedia := table.FluoPostMedia
	messageMedia := table.LigoMessageMedia
	claims := table.NodoUploadClaims
	uploadID := jetUUID(id)
	err := jetQueryRow(ctx, store.pool, jetpg.SELECT(jetpg.OR(
		jetpg.EXISTS(jetpg.SELECT(postMedia.UploadID).FROM(postMedia).WHERE(postMedia.UploadID.EQ(uploadID))),
		jetpg.EXISTS(jetpg.SELECT(messageMedia.UploadID).FROM(messageMedia).WHERE(messageMedia.UploadID.EQ(uploadID))),
		jetpg.EXISTS(jetpg.SELECT(claims.UploadID).FROM(claims).WHERE(jetpg.AND(
			claims.UploadID.EQ(uploadID), claims.RetiredAt.IS_NULL(),
		))),
	))).Scan(&referenced)
	return referenced, err
}

func (store *Fluo) SetSaved(ctx context.Context, viewerID, postID string, saved bool) error {
	if _, err := store.Get(ctx, viewerID, postID); err != nil {
		return err
	}
	if saved {
		savedPosts := table.FluoSavedPosts
		_, err := jetExec(ctx, store.pool, savedPosts.INSERT(savedPosts.UserID, savedPosts.PostID).
			VALUES(jetUUID(viewerID), jetUUID(postID)).ON_CONFLICT(savedPosts.UserID, savedPosts.PostID).DO_NOTHING())
		return err
	}
	savedPosts := table.FluoSavedPosts
	_, err := jetExec(ctx, store.pool, savedPosts.DELETE().WHERE(jetpg.AND(
		savedPosts.UserID.EQ(jetUUID(viewerID)), savedPosts.PostID.EQ(jetUUID(postID)),
	)))
	return err
}

func (store *Fluo) React(ctx context.Context, actorID, postID string, value *string) (fluo.Post, error) {
	if _, err := store.Get(ctx, actorID, postID); err != nil {
		return fluo.Post{}, err
	}
	reactions := table.FluoReactions
	if value == nil {
		_, err := jetExec(ctx, store.pool, reactions.DELETE().WHERE(jetpg.AND(
			reactions.PostID.EQ(jetUUID(postID)), reactions.UserID.EQ(jetUUID(actorID)),
		)))
		if err != nil {
			return fluo.Post{}, err
		}
	} else {
		_, err := jetExec(ctx, store.pool, reactions.INSERT(reactions.PostID, reactions.UserID, reactions.Value).
			VALUES(jetUUID(postID), jetUUID(actorID), jetpg.String(*value)).
			ON_CONFLICT(reactions.PostID, reactions.UserID).DO_UPDATE(jetpg.SET(
			reactions.Value.SET(reactions.EXCLUDED.Value),
		)))
		if err != nil {
			return fluo.Post{}, err
		}
	}
	return store.Get(ctx, actorID, postID)
}

func (store *Fluo) Follow(ctx context.Context, actorID, targetID string, following bool) error {
	if actorID == targetID {
		return fluo.ErrSelfFollow
	}
	var exists bool
	users := table.Users
	if err := jetQueryRow(ctx, store.pool, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(users.ID).FROM(users).
		WHERE(users.ID.EQ(jetUUID(targetID)))))).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fluo.ErrNotFound
	}
	if following {
		follows := table.FluoFollows
		_, err := jetExec(ctx, store.pool, follows.INSERT(follows.FollowerID, follows.FollowedID).
			VALUES(jetUUID(actorID), jetUUID(targetID)).ON_CONFLICT().DO_NOTHING())
		return err
	}
	follows := table.FluoFollows
	_, err := jetExec(ctx, store.pool, follows.DELETE().WHERE(jetpg.AND(
		follows.FollowerID.EQ(jetUUID(actorID)), follows.FollowedID.EQ(jetUUID(targetID)),
	)))
	return err
}

var _ fluo.Store = (*Fluo)(nil)
