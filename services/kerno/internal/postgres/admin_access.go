package postgres

// Creates and closes audited administrator access cases
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func (store *Admin) CreateAccessCase(ctx context.Context, actorID, targetID, reason string) (admin.AccessCase, error) {
	if actorID == targetID {
		return admin.AccessCase{}, admin.ErrTarget
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return admin.AccessCase{}, err
	}
	defer tx.Rollback(ctx)

	actorName, err := lockAccessCaseActor(ctx, tx, actorID)
	if err != nil {
		return admin.AccessCase{}, err
	}
	if err := enforceAccessCaseLimit(ctx, tx, actorID); err != nil {
		return admin.AccessCase{}, err
	}
	targetUserID, targetUsername, err := lockAccessCaseTarget(ctx, tx, targetID)
	if err != nil {
		return admin.AccessCase{}, err
	}
	item, err := insertAccessCase(ctx, tx, actorID, targetUserID, targetUsername, reason)
	if err != nil {
		return admin.AccessCase{}, err
	}
	if err := notifyAccessCase(ctx, tx, actorID, targetID, actorName, reason, item.ID); err != nil {
		return admin.AccessCase{}, err
	}
	return item, tx.Commit(ctx)
}

func lockAccessCaseActor(ctx context.Context, tx pgx.Tx, actorID string) (string, error) {
	users := table.Users
	var username string
	err := jetQueryRow(ctx, tx, users.SELECT(users.Username).
		WHERE(users.ID.EQ(jetUUID(actorID))).FOR(jetpg.UPDATE())).Scan(&username)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", admin.ErrNotFound
	}
	return username, err
}

func enforceAccessCaseLimit(ctx context.Context, tx pgx.Tx, actorID string) error {
	cases := table.AdminAccessCases
	var recent int
	err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(cases.ID)).FROM(cases).WHERE(jetpg.AND(
		cases.ActorID.EQ(jetUUID(actorID)), cases.CreatedAt.GT(jetpg.RawTimestampz("clock_timestamp() - interval '1 hour'")),
	))).Scan(&recent)
	if err != nil {
		return err
	}
	if recent >= 3 {
		return admin.ErrAccessLimit
	}
	return nil
}

func lockAccessCaseTarget(ctx context.Context, tx pgx.Tx, targetID string) (string, string, error) {
	users := table.Users
	var userID, username string
	err := jetQueryRow(ctx, tx, users.SELECT(jetpg.CAST(users.ID).AS_TEXT(), users.Username).
		WHERE(users.ID.EQ(jetUUID(targetID))).FOR(jetpg.SHARE())).Scan(&userID, &username)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", admin.ErrTarget
	}
	return userID, username, err
}

func insertAccessCase(ctx context.Context, tx pgx.Tx, actorID, targetID, targetUsername, reason string) (admin.AccessCase, error) {
	item := admin.AccessCase{TargetUserID: targetID, TargetUsername: targetUsername, Reason: reason}
	cases := table.AdminAccessCases
	err := jetQueryRow(ctx, tx, cases.INSERT(cases.ActorID, cases.TargetUserID, cases.Reason).
		VALUES(jetUUID(actorID), jetUUID(targetID), jetpg.String(reason)).
		RETURNING(jetpg.CAST(cases.ID).AS_TEXT(), cases.CreatedAt, cases.ExpiresAt)).
		Scan(&item.ID, &item.CreatedAt, &item.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, admin.ErrNotFound
	}
	return item, err
}

func notifyAccessCase(ctx context.Context, tx pgx.Tx, actorID, targetID, actorName, reason, caseID string) error {
	conversationID, err := ensureSavedConversation(ctx, tx, targetID)
	if err != nil {
		return err
	}
	if err := addSavedConversationMember(ctx, tx, conversationID, targetID); err != nil {
		return err
	}
	if err := sendAccessCaseNotice(ctx, tx, conversationID, targetID, actorName, reason, caseID); err != nil {
		return err
	}
	if err := recordAccessCaseOpened(ctx, tx, actorID, targetID, reason, caseID); err != nil {
		return err
	}
	return jetNotify(ctx, tx, "ligo_activity", conversationID)
}

func ensureSavedConversation(ctx context.Context, tx pgx.Tx, targetID string) (string, error) {
	conversations := table.LigoConversations
	var conversationID string
	err := jetQueryRow(ctx, tx, conversations.INSERT(conversations.Kind, conversations.CreatedBy).
		VALUES(jetpg.String("self"), jetUUID(targetID)).
		ON_CONFLICT(conversations.CreatedBy).WHERE(conversations.Kind.EQ(jetpg.String("self"))).
		DO_UPDATE(jetpg.SET(conversations.CreatedBy.SET(conversations.EXCLUDED.CreatedBy))).
		RETURNING(jetpg.CAST(conversations.ID).AS_TEXT())).Scan(&conversationID)
	return conversationID, err
}

func addSavedConversationMember(ctx context.Context, tx pgx.Tx, conversationID, targetID string) error {
	members := table.LigoMembers
	_, err := jetExec(ctx, tx, members.INSERT(members.ConversationID, members.UserID).
		VALUES(jetUUID(conversationID), jetUUID(targetID)).ON_CONFLICT().DO_NOTHING())
	return err
}

func sendAccessCaseNotice(ctx context.Context, tx pgx.Tx, conversationID, targetID, actorName, reason, caseID string) error {
	notice := fmt.Sprintf("Administrator @%s opened a 15-minute access case for content associated with your account. Reason: %s. Case ID: %s", actorName, reason, caseID)
	messages := table.LigoMessages
	if _, err := jetExec(ctx, tx, messages.INSERT(messages.ConversationID, messages.SenderID, messages.ClientID, messages.Body, messages.SystemNotice).
		VALUES(jetUUID(conversationID), jetUUID(targetID), jetpg.RawString("uuidv7()"), jetpg.String(notice), jetpg.Bool(true))); err != nil {
		return err
	}
	conversations := table.LigoConversations
	_, err := jetExec(ctx, tx, conversations.UPDATE().SET(
		conversations.UpdatedAt.SET(jetpg.RawTimestampz("clock_timestamp()")),
	).WHERE(conversations.ID.EQ(jetUUID(conversationID))))
	return err
}

func recordAccessCaseOpened(ctx context.Context, tx pgx.Tx, actorID, targetID, reason, caseID string) error {
	detail, _ := json.Marshal(map[string]string{"caseId": caseID})
	audit := table.AdminAudit
	_, err := jetExec(ctx, tx, audit.INSERT(audit.ActorID, audit.TargetUserID, audit.Action, audit.Reason, audit.Detail).
		VALUES(jetUUID(actorID), jetUUID(targetID), jetpg.String("case.opened"), jetpg.String(reason), jetpg.Json(detail)))
	return err
}

func (store *Admin) AccessCase(ctx context.Context, actorID, caseID string) (admin.AccessCase, error) {
	var item admin.AccessCase
	cases := table.AdminAccessCases.AS("c")
	users := table.Users.AS("u")
	err := jetQueryRow(ctx, store.pool, jetpg.SELECT(jetpg.CAST(cases.ID).AS_TEXT(), jetpg.CAST(cases.TargetUserID).AS_TEXT(),
		users.Username, cases.Reason, cases.CreatedAt, cases.ExpiresAt).
		FROM(cases.INNER_JOIN(users, users.ID.EQ(cases.TargetUserID))).WHERE(jetpg.AND(
		cases.ID.EQ(jetUUID(caseID)), cases.ActorID.EQ(jetUUID(actorID)),
		cases.ExpiresAt.GT(jetpg.RawTimestampz("clock_timestamp()")),
	))).Scan(&item.ID, &item.TargetUserID, &item.TargetUsername,
		&item.Reason, &item.CreatedAt, &item.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, admin.ErrNotFound
	}
	return item, err
}

func (store *Admin) CloseCase(ctx context.Context, actorID, caseID string) error {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	targetID, reason, err := lockAccessCase(ctx, tx, actorID, caseID)
	if err != nil {
		return err
	}
	closed, err := expireAccessCase(ctx, tx, caseID)
	if err != nil {
		return err
	}
	if closed {
		if err := recordAccessCaseClosed(ctx, tx, actorID, targetID, reason, caseID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func lockAccessCase(ctx context.Context, tx pgx.Tx, actorID, caseID string) (string, string, error) {
	cases := table.AdminAccessCases
	var targetID, reason string
	err := jetQueryRow(ctx, tx, cases.SELECT(jetpg.CAST(cases.TargetUserID).AS_TEXT(), cases.Reason).
		WHERE(jetpg.AND(cases.ID.EQ(jetUUID(caseID)), cases.ActorID.EQ(jetUUID(actorID)))).
		FOR(jetpg.UPDATE())).Scan(&targetID, &reason)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", admin.ErrNotFound
	}
	return targetID, reason, err
}

func expireAccessCase(ctx context.Context, tx pgx.Tx, caseID string) (bool, error) {
	cases := table.AdminAccessCases
	result, err := jetExec(ctx, tx, cases.UPDATE().SET(cases.ExpiresAt.SET(jetpg.RawTimestampz("clock_timestamp()"))).
		WHERE(jetpg.AND(cases.ID.EQ(jetUUID(caseID)), cases.ExpiresAt.GT(jetpg.RawTimestampz("clock_timestamp()")))))
	if err != nil {
		return false, err
	}
	return result.RowsAffected() > 0, nil
}

func recordAccessCaseClosed(ctx context.Context, tx pgx.Tx, actorID, targetID, reason, caseID string) error {
	detail, _ := json.Marshal(map[string]string{"caseId": caseID})
	audit := table.AdminAudit
	_, err := jetExec(ctx, tx, audit.INSERT(audit.ActorID, audit.TargetUserID, audit.Action, audit.Reason, audit.Detail).
		VALUES(jetUUID(actorID), jetUUID(targetID), jetpg.String("case.closed"), jetpg.String(reason), jetpg.Json(detail)))
	return err
}
