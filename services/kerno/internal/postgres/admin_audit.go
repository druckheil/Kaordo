package postgres

// Reads and records administrator audit entries
import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
)

type AdminAuditEntry struct {
	ID        string          `json:"id"`
	Actor     string          `json:"actor"`
	Target    *string         `json:"target"`
	Action    string          `json:"action"`
	Reason    string          `json:"reason"`
	Detail    json.RawMessage `json:"detail"`
	CreatedAt time.Time       `json:"createdAt"`
}

func (store *Admin) Audit(ctx context.Context) ([]AdminAuditEntry, error) {
	audit := table.AdminAudit.AS("a")
	actor := table.Users.AS("actor")
	target := table.Users.AS("target")
	rows, err := jetQuery(ctx, store.pool, jetpg.SELECT(jetpg.CAST(audit.ID).AS_TEXT(), actor.Username, target.Username,
		audit.Action, audit.Reason, audit.Detail, audit.CreatedAt).
		FROM(audit.INNER_JOIN(actor, actor.ID.EQ(audit.ActorID)).
			LEFT_JOIN(target, target.ID.EQ(audit.TargetUserID))).
		ORDER_BY(audit.CreatedAt.DESC(), audit.ID.DESC()).LIMIT(100))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AdminAuditEntry, 0)
	for rows.Next() {
		var item AdminAuditEntry
		if err := rows.Scan(&item.ID, &item.Actor, &item.Target, &item.Action,
			&item.Reason, &item.Detail, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *Admin) Record(ctx context.Context, actorID, targetID, action, reason string, detail any) error {
	encoded, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("encode audit detail: %w", err)
	}
	var target *string
	if targetID != "" {
		target = &targetID
	}
	audit := table.AdminAudit
	_, err = jetExec(ctx, store.pool, audit.INSERT(audit.ActorID, audit.TargetUserID, audit.Action, audit.Reason, audit.Detail).
		VALUES(jetUUID(actorID), nullableUUID(target), jetpg.String(action), jetpg.String(reason), jetpg.Json(encoded)))
	return err
}
