package postgres

// Manages Fluo media references, saves, reactions, and follows
import (
	"context"
	"errors"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func (store *Fluo) MediaReferenced(ctx context.Context, id string) (bool, error) {
	var referenced bool
	postMedia := table.FluoPostMedia
	messageMedia := table.LigoMessageMedia
	profileImages := table.FluoProfileImages
	diaryMedia := table.MemoroDayMedia
	claims := table.NodoUploadClaims
	uploadID := jetUUID(id)
	err := jetQueryRow(ctx, store.pool, jetpg.SELECT(jetpg.OR(
		jetpg.EXISTS(jetpg.SELECT(postMedia.UploadID).FROM(postMedia).WHERE(postMedia.UploadID.EQ(uploadID))),
		jetpg.EXISTS(jetpg.SELECT(messageMedia.UploadID).FROM(messageMedia).WHERE(messageMedia.UploadID.EQ(uploadID))),
		jetpg.EXISTS(jetpg.SELECT(diaryMedia.UploadID).FROM(diaryMedia).WHERE(diaryMedia.UploadID.EQ(uploadID))),
		jetpg.EXISTS(jetpg.SELECT(profileImages.UploadID).FROM(profileImages).WHERE(profileImages.UploadID.EQ(uploadID))),
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
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return fluo.Post{}, err
	}
	defer tx.Rollback(ctx)
	// A shared row lock guards access/deletion without serializing different users' reactions.
	posts := table.FluoPosts.AS("p")
	condition := jetpg.AND(posts.ID.EQ(jetUUID(postID)), postAccessibleCondition(actorID, posts))
	var lockedID string
	err = jetQueryRow(ctx, tx, posts.SELECT(jetpg.CAST(posts.ID).AS_TEXT()).WHERE(condition).
		FOR(jetpg.SHARE())).Scan(&lockedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fluo.Post{}, fluo.ErrNotFound
	}
	if err != nil {
		return fluo.Post{}, err
	}
	if err := writeFluoReaction(ctx, tx, actorID, postID, value); err != nil {
		return fluo.Post{}, err
	}
	post, err := scanPost(jetQueryRow(ctx, tx, postQuery(actorID).WHERE(condition)))
	if err != nil {
		return fluo.Post{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return fluo.Post{}, err
	}
	return post, nil
}

func writeFluoReaction(ctx context.Context, tx pgx.Tx, actorID, postID string, value *string) error {
	reactions := table.FluoReactions
	if value == nil {
		_, err := jetExec(ctx, tx, reactions.DELETE().WHERE(jetpg.AND(
			reactions.PostID.EQ(jetUUID(postID)), reactions.UserID.EQ(jetUUID(actorID)),
		)))
		return err
	}
	changed, err := jetExec(ctx, tx, reactions.INSERT(reactions.PostID, reactions.UserID, reactions.Value).
		VALUES(jetUUID(postID), jetUUID(actorID), jetpg.String(*value)).
		ON_CONFLICT(reactions.PostID, reactions.UserID).DO_UPDATE(jetpg.SET(
		reactions.Value.SET(reactions.EXCLUDED.Value),
	).WHERE(reactions.Value.NOT_EQ(reactions.EXCLUDED.Value))))
	if err != nil || changed.RowsAffected() == 0 {
		return err
	}
	kind := fluo.NotificationLike
	if *value == "bad" {
		kind = fluo.NotificationDislike
	}
	return recordPostNotification(ctx, tx, actorID, postID, kind)
}

func (store *Fluo) Follow(ctx context.Context, actorID, targetID string, following bool) error {
	if strings.EqualFold(actorID, targetID) {
		return fluo.ErrSelfFollow
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var exists bool
	users := table.Users
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(users.ID).FROM(users).
		WHERE(users.ID.EQ(jetUUID(targetID)))))).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fluo.ErrNotFound
	}
	if err := writeFluoFollow(ctx, tx, actorID, targetID, following); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func writeFluoFollow(ctx context.Context, tx pgx.Tx, actorID, targetID string, following bool) error {
	follows := table.FluoFollows
	kind := fluo.NotificationUnfollow
	var change jetpg.Statement = follows.DELETE().WHERE(jetpg.AND(
		follows.FollowerID.EQ(jetUUID(actorID)), follows.FollowedID.EQ(jetUUID(targetID)),
	))
	if following {
		kind = fluo.NotificationFollow
		change = follows.INSERT(follows.FollowerID, follows.FollowedID).
			VALUES(jetUUID(actorID), jetUUID(targetID)).ON_CONFLICT().DO_NOTHING()
	}
	changed, err := jetExec(ctx, tx, change)
	if err != nil || changed.RowsAffected() == 0 {
		return err
	}
	if !following {
		// An unfollowed account loses future server access to the author's audience keys.
		if _, err := jetExec(ctx, tx, jetpg.RawStatement(`DELETE FROM fluo_keyring_grants WHERE owner_id = #owner::uuid AND recipient_id = #recipient::uuid`,
			jetpg.RawArgs{"#owner": actorID, "#recipient": targetID})); err != nil {
			return err
		}
	}
	return recordFollowNotification(ctx, tx, actorID, targetID, kind)
}

var _ fluo.Store = (*Fluo)(nil)
