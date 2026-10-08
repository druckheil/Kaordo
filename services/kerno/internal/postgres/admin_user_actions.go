package postgres

// Applies administrator account and role changes transactionally
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func (store *Admin) SetDisabled(ctx context.Context, actorID, targetID string, disabled bool, reason string) (admin.User, error) {
	if actorID == targetID {
		return admin.User{}, admin.ErrTarget
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return admin.User{}, err
	}
	defer tx.Rollback(ctx)

	if err := lockDisableTarget(ctx, tx, targetID); err != nil {
		return admin.User{}, err
	}
	if err := updateDisabledState(ctx, tx, targetID, disabled, reason); err != nil {
		return admin.User{}, err
	}
	if err := recordUserAction(ctx, tx, actorID, targetID, disabledAction(disabled), reason); err != nil {
		return admin.User{}, err
	}
	user, err := findAdminUser(ctx, tx, targetID)
	if err != nil {
		return admin.User{}, err
	}
	return user, tx.Commit(ctx)
}

func lockDisableTarget(ctx context.Context, tx pgx.Tx, targetID string) error {
	users := table.Users
	roles := table.UserRoles.AS("roles")
	var isAdmin bool
	err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(roles.UserID).FROM(roles).
		WHERE(jetpg.AND(roles.UserID.EQ(users.ID), roles.Role.EQ(jetpg.String("admin")))))).
		FROM(users).WHERE(users.ID.EQ(jetUUID(targetID))).FOR(jetpg.UPDATE())).Scan(&isAdmin)
	if errors.Is(err, pgx.ErrNoRows) || isAdmin {
		return admin.ErrTarget
	}
	return err
}

func updateDisabledState(ctx context.Context, tx pgx.Tx, targetID string, disabled bool, reason string) error {
	users := table.Users
	_, err := jetExec(ctx, tx, users.UPDATE().SET(
		users.DisabledAt.SET(jetpg.RawTimestampz("CASE WHEN #disabled THEN clock_timestamp() ELSE NULL END", jetpg.RawArgs{"#disabled": disabled})),
		users.DisabledReason.SET(jetpg.RawString("CASE WHEN #disabled THEN #reason ELSE '' END", jetpg.RawArgs{"#disabled": disabled, "#reason": reason})),
		users.UpdatedAt.SET(jetpg.RawTimestampz("clock_timestamp()")),
	).WHERE(users.ID.EQ(jetUUID(targetID))))
	return err
}

func (store *Admin) SetAdmin(ctx context.Context, actorID, targetID string, enabled bool, reason string) (admin.User, error) {
	if actorID == targetID {
		return admin.User{}, admin.ErrTarget
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return admin.User{}, err
	}
	defer tx.Rollback(ctx)

	if err := verifyAdminManager(ctx, tx, actorID); err != nil {
		return admin.User{}, err
	}
	disabled, err := targetIsDisabled(ctx, tx, targetID)
	if err != nil {
		return admin.User{}, err
	}
	if enabled && disabled {
		return admin.User{}, admin.ErrTarget
	}
	if err := changeAdminRole(ctx, tx, targetID, enabled); err != nil {
		return admin.User{}, err
	}
	if err := recordUserAction(ctx, tx, actorID, targetID, adminRoleAction(enabled), reason); err != nil {
		return admin.User{}, err
	}
	user, err := findAdminUser(ctx, tx, targetID)
	if err != nil {
		return admin.User{}, err
	}
	return user, tx.Commit(ctx)
}

func verifyAdminManager(ctx context.Context, tx pgx.Tx, actorID string) error {
	// Serialize changes and recheck the actor to prevent concurrent mutual revocations.
	if err := jetAdvisoryLock(ctx, tx, jetpg.RawString("pg_advisory_xact_lock(776620003)")); err != nil {
		return err
	}
	users := table.Users.AS("actor")
	roles := table.UserRoles.AS("role")
	query := jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(roles.UserID).
		FROM(users.INNER_JOIN(roles, roles.UserID.EQ(users.ID))).WHERE(jetpg.AND(
		users.ID.EQ(jetUUID(actorID)), roles.Role.EQ(jetpg.String("admin")), users.DisabledAt.IS_NULL(),
	))))
	var allowed bool
	if err := jetQueryRow(ctx, tx, query).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return admin.ErrTarget
	}
	return nil
}

func targetIsDisabled(ctx context.Context, tx pgx.Tx, targetID string) (bool, error) {
	users := table.Users
	var disabled bool
	err := jetQueryRow(ctx, tx, users.SELECT(jetpg.RawBool("disabled_at IS NOT NULL")).
		WHERE(users.ID.EQ(jetUUID(targetID))).FOR(jetpg.UPDATE())).Scan(&disabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, admin.ErrTarget
	}
	return disabled, err
}

func changeAdminRole(ctx context.Context, tx pgx.Tx, targetID string, enabled bool) error {
	roles := table.UserRoles
	if enabled {
		_, err := jetExec(ctx, tx, roles.INSERT(roles.UserID, roles.Role).
			VALUES(jetUUID(targetID), jetpg.String("admin")).ON_CONFLICT().DO_NOTHING())
		return err
	}
	_, err := jetExec(ctx, tx, roles.DELETE().WHERE(jetpg.AND(
		roles.UserID.EQ(jetUUID(targetID)), roles.Role.EQ(jetpg.String("admin")),
	)))
	return err
}

func recordUserAction(ctx context.Context, tx pgx.Tx, actorID, targetID, action, reason string) error {
	audit := table.AdminAudit
	_, err := jetExec(ctx, tx, audit.INSERT(audit.ActorID, audit.TargetUserID, audit.Action, audit.Reason).
		VALUES(jetUUID(actorID), jetUUID(targetID), jetpg.String(action), jetpg.String(reason)))
	return err
}

func disabledAction(disabled bool) string {
	if disabled {
		return "user.disabled"
	}
	return "user.enabled"
}

func adminRoleAction(enabled bool) string {
	if enabled {
		return "user.admin_granted"
	}
	return "user.admin_revoked"
}

func findAdminUser(ctx context.Context, executor jetExecutor, id string) (admin.User, error) {
	query, users := adminUserQuery()
	return scanAdminUser(jetQueryRow(ctx, executor, query.WHERE(users.ID.EQ(jetUUID(id)))))
}
