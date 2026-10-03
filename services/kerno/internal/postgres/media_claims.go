package postgres

// Retires upload claims after their final message or post reference is removed
import (
	"context"
	"sort"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func claimUploads(ctx context.Context, tx pgx.Tx, ownerID string, uploadIDs []string) (bool, error) {
	orderedIDs := append([]string(nil), uploadIDs...)
	sort.Strings(orderedIDs)

	claims := table.NodoUploadClaims
	for _, uploadID := range orderedIDs {
		result, err := jetExec(ctx, tx, claims.INSERT(claims.UploadID, claims.OwnerID).
			VALUES(jetUUID(uploadID), jetUUID(ownerID)).
			ON_CONFLICT(claims.UploadID).DO_UPDATE(jetpg.SET(
			claims.OwnerID.SET(claims.EXCLUDED.OwnerID),
		).WHERE(jetpg.AND(claims.OwnerID.EQ(claims.EXCLUDED.OwnerID), claims.RetiredAt.IS_NULL()))))
		if err != nil {
			return false, err
		}
		if result.RowsAffected() == 0 {
			return false, nil
		}
	}
	return true, nil
}

func retireUnreferencedUpload(ctx context.Context, tx pgx.Tx, uploadID string) (bool, error) {
	claim := table.NodoUploadClaims.AS("claim")
	postMedia := table.FluoPostMedia.AS("post_media")
	messageMedia := table.LigoMessageMedia.AS("message_media")
	unused := jetpg.AND(
		jetpg.NOT(jetpg.EXISTS(jetpg.SELECT(postMedia.UploadID).FROM(postMedia).
			WHERE(postMedia.UploadID.EQ(claim.UploadID)))),
		jetpg.NOT(jetpg.EXISTS(jetpg.SELECT(messageMedia.UploadID).FROM(messageMedia).
			WHERE(messageMedia.UploadID.EQ(claim.UploadID)))),
	)
	result, err := jetExec(ctx, tx, claim.UPDATE().SET(
		claim.RetiredAt.SET(jetpg.RawTimestampz("now()")),
	).WHERE(jetpg.AND(claim.UploadID.EQ(jetUUID(uploadID)), claim.RetiredAt.IS_NULL(), unused)))
	if err != nil {
		return false, err
	}
	return result.RowsAffected() > 0, nil
}
