package postgres

// Persists chosen availability and renews active Fluo sessions without retaining a session log
import (
	"context"
	"encoding/json"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
)

func (store *Fluo) TouchPresence(ctx context.Context, userID string) error {
	profile := table.FluoProfiles
	_, err := jetExec(ctx, store.pool, profile.INSERT(profile.UserID, profile.LastActiveAt).
		VALUES(jetUUID(userID), jetpg.RawTimestampz("now()")).ON_CONFLICT(profile.UserID).
		DO_UPDATE(jetpg.SET(profile.LastActiveAt.SET(profile.EXCLUDED.LastActiveAt)).WHERE(jetpg.OR(
			profile.LastActiveAt.IS_NULL(), profile.LastActiveAt.LT(jetpg.RawTimestampz("now() - interval '1 second'")),
		))))
	return err
}

func (store *Fluo) Presentations(ctx context.Context, viewerID string, ids []string) ([]fluo.UserPresentation, error) {
	user := table.Users.AS("presentation_user")
	profile := table.FluoProfiles.AS("presentation_profile")
	settings := table.FluoSettings.AS("presentation_settings")
	rows, err := jetQuery(ctx, store.pool, jetpg.SELECT(jetpg.CAST(user.ID).AS_TEXT(),
		fluoImageJSON(user.ID, "avatar"), fluoPresence(viewerID, user.ID, profile, settings)).
		FROM(user.LEFT_JOIN(profile, profile.UserID.EQ(user.ID)).LEFT_JOIN(settings, settings.UserID.EQ(user.ID))).
		WHERE(jetpg.AND(user.ID.IN(jetUUIDList(ids)...), user.DisabledAt.IS_NULL())).ORDER_BY(user.ID.ASC()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]fluo.UserPresentation, 0, len(ids))
	for rows.Next() {
		var item fluo.UserPresentation
		var avatar []byte
		if err := rows.Scan(&item.ID, &avatar, &item.Presence); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(avatar, &item.Avatar); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *Fluo) SetStatus(ctx context.Context, userID, status string) (fluo.Profile, error) {
	if !fluo.ValidStatus(status) {
		return fluo.Profile{}, fluo.ErrInvalidSettings
	}
	profile := table.FluoProfiles
	_, err := jetExec(ctx, store.pool, profile.INSERT(profile.UserID, profile.Status, profile.LastActiveAt).
		VALUES(jetUUID(userID), status, jetpg.RawTimestampz("now()")).ON_CONFLICT(profile.UserID).
		DO_UPDATE(jetpg.SET(profile.Status.SET(profile.EXCLUDED.Status), profile.LastActiveAt.SET(profile.EXCLUDED.LastActiveAt))))
	if err != nil {
		return fluo.Profile{}, err
	}
	return ownedFluoProfile(ctx, store.pool, userID)
}
