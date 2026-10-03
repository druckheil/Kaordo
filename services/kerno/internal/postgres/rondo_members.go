package postgres

// Creates servers and manages Rondo membership
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondo"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func (store *Rondo) Create(ctx context.Context, actorID string, input rondo.NewServer) (rondo.Detail, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return rondo.Detail{}, err
	}
	defer tx.Rollback(ctx)

	if err := lockRondoUser(ctx, tx, actorID); err != nil {
		return rondo.Detail{}, err
	}
	if err := enforceRondoOwnedServerLimit(ctx, tx, actorID); err != nil {
		return rondo.Detail{}, err
	}
	if err := checkRondoUserLimit(ctx, tx, actorID); err != nil {
		return rondo.Detail{}, err
	}
	serverID, err := insertRondoServer(ctx, tx, actorID, input)
	if err != nil {
		return rondo.Detail{}, err
	}
	if err := addRondoServerOwner(ctx, tx, serverID, actorID); err != nil {
		return rondo.Detail{}, err
	}
	if _, err := insertRondoChannel(ctx, tx, serverID, actorID, "general"); err != nil {
		return rondo.Detail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return rondo.Detail{}, err
	}
	return store.Get(ctx, actorID, serverID)
}

func lockRondoUser(ctx context.Context, tx pgx.Tx, userID string) error {
	users := table.Users
	var locked string
	return jetQueryRow(ctx, tx, users.SELECT(jetpg.CAST(users.ID).AS_TEXT()).
		WHERE(users.ID.EQ(jetUUID(userID))).FOR(jetpg.UPDATE())).Scan(&locked)
}

func enforceRondoOwnedServerLimit(ctx context.Context, tx pgx.Tx, ownerID string) error {
	servers := table.RondoServers
	var owned int
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(servers.ID)).FROM(servers).
		WHERE(servers.OwnerID.EQ(jetUUID(ownerID)))).Scan(&owned); err != nil {
		return err
	}
	if owned >= 20 {
		return rondo.ErrLimit
	}
	return nil
}

func insertRondoServer(ctx context.Context, tx pgx.Tx, ownerID string, input rondo.NewServer) (string, error) {
	servers := table.RondoServers
	var id string
	err := jetQueryRow(ctx, tx, servers.INSERT(servers.Name, servers.Description, servers.Access, servers.OwnerID).
		VALUES(jetpg.String(input.Name), jetpg.String(input.Description), jetpg.String(input.Access), jetUUID(ownerID)).
		RETURNING(jetpg.CAST(servers.ID).AS_TEXT())).Scan(&id)
	return id, err
}

func addRondoServerOwner(ctx context.Context, tx pgx.Tx, serverID, ownerID string) error {
	members := table.RondoMembers
	_, err := jetExec(ctx, tx, members.INSERT(members.ServerID, members.UserID).
		VALUES(jetUUID(serverID), jetUUID(ownerID)))
	return err
}

func (store *Rondo) Join(ctx context.Context, actorID, serverID string) (rondo.Detail, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return rondo.Detail{}, err
	}
	defer tx.Rollback(ctx)

	access, err := lockRondoServerAccess(ctx, tx, serverID)
	if err != nil {
		return rondo.Detail{}, err
	}
	member, err := rondoMemberExists(ctx, tx, serverID, actorID)
	if err != nil {
		return rondo.Detail{}, err
	}
	if !member {
		if access != "public" {
			return rondo.Detail{}, rondo.ErrForbidden
		}
		if err := addMemberWithinCapacity(ctx, tx, serverID, actorID); err != nil {
			return rondo.Detail{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return rondo.Detail{}, err
	}
	return store.Get(ctx, actorID, serverID)
}

func lockRondoServerAccess(ctx context.Context, tx pgx.Tx, serverID string) (string, error) {
	servers := table.RondoServers
	var access string
	err := jetQueryRow(ctx, tx, servers.SELECT(servers.Access).
		WHERE(servers.ID.EQ(jetUUID(serverID))).FOR(jetpg.UPDATE())).Scan(&access)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", rondo.ErrNotFound
	}
	return access, err
}

func lockRondoServerOwner(ctx context.Context, tx pgx.Tx, serverID string) (string, error) {
	servers := table.RondoServers
	var ownerID string
	err := jetQueryRow(ctx, tx, servers.SELECT(jetpg.CAST(servers.OwnerID).AS_TEXT()).
		WHERE(servers.ID.EQ(jetUUID(serverID))).FOR(jetpg.UPDATE())).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", rondo.ErrNotFound
	}
	return ownerID, err
}

func rondoMemberExists(ctx context.Context, tx pgx.Tx, serverID, userID string) (bool, error) {
	members := table.RondoMembers
	query := jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(members.UserID).FROM(members).
		WHERE(jetpg.AND(members.ServerID.EQ(jetUUID(serverID)), members.UserID.EQ(jetUUID(userID))))))
	var exists bool
	err := jetQueryRow(ctx, tx, query).Scan(&exists)
	return exists, err
}

func addMemberWithinCapacity(ctx context.Context, tx pgx.Tx, serverID, userID string) error {
	if err := checkRondoMemberLimit(ctx, tx, serverID); err != nil {
		return err
	}
	if err := checkRondoUserLimit(ctx, tx, userID); err != nil {
		return err
	}
	return addRondoMember(ctx, tx, serverID, userID)
}

func checkRondoMemberLimit(ctx context.Context, tx pgx.Tx, serverID string) error {
	var total int
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(table.RondoMembers.UserID)).
		FROM(table.RondoMembers).WHERE(table.RondoMembers.ServerID.EQ(jetUUID(serverID)))).Scan(&total); err != nil {
		return err
	}
	if total >= 500 {
		return rondo.ErrLimit
	}
	return nil
}

func checkRondoUserLimit(ctx context.Context, tx pgx.Tx, userID string) error {
	if err := lockRondoUser(ctx, tx, userID); err != nil {
		return err
	}
	var total int
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(table.RondoMembers.UserID)).
		FROM(table.RondoMembers).WHERE(table.RondoMembers.UserID.EQ(jetUUID(userID)))).Scan(&total); err != nil {
		return err
	}
	if total >= 100 {
		return rondo.ErrLimit
	}
	return nil
}

// Ligo sends lock the conversation before checking membership. Lock those same
// rows during server changes so joining users see a consistent message boundary.
func lockRondoConversations(ctx context.Context, tx pgx.Tx, serverID string) ([]string, error) {
	channelTable := table.RondoChannels.AS("channel")
	conversations := table.LigoConversations.AS("conversation")
	statement := jetpg.SELECT(jetpg.CAST(channelTable.ID).AS_TEXT()).
		FROM(channelTable.INNER_JOIN(conversations, conversations.ID.EQ(channelTable.ConversationID))).
		WHERE(channelTable.ServerID.EQ(jetUUID(serverID))).
		ORDER_BY(conversations.ID.ASC()).FOR(jetpg.UPDATE().OF(conversations))
	rows, err := jetQuery(ctx, tx, statement)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	channelIDs := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		channelIDs = append(channelIDs, id)
	}
	return channelIDs, rows.Err()
}

func addRondoMember(ctx context.Context, tx pgx.Tx, serverID, userID string) error {
	members := table.RondoMembers
	if _, err := jetExec(ctx, tx, members.INSERT(members.ServerID, members.UserID).
		VALUES(jetUUID(serverID), jetUUID(userID))); err != nil {
		return err
	}
	if _, err := lockRondoConversations(ctx, tx, serverID); err != nil {
		return err
	}

	channels := table.RondoChannels.AS("channel")
	ligoMembers := table.LigoMembers
	_, err := jetExec(ctx, tx, ligoMembers.INSERT(ligoMembers.ConversationID, ligoMembers.UserID, ligoMembers.JoinedAt).
		QUERY(jetpg.SELECT(channels.ConversationID, jetUUID(userID), jetpg.RawTimestampz("clock_timestamp()")).
			FROM(channels).WHERE(channels.ServerID.EQ(jetUUID(serverID)))))
	return err
}

func (store *Rondo) Invite(ctx context.Context, actorID, serverID, userID string) (rondo.Detail, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return rondo.Detail{}, err
	}
	defer tx.Rollback(ctx)

	ownerID, err := lockRondoServerOwner(ctx, tx, serverID)
	if err != nil {
		return rondo.Detail{}, err
	}
	if ownerID != actorID {
		return rondo.Detail{}, rondo.ErrForbidden
	}
	if err := ensureRondoUserExists(ctx, tx, userID); err != nil {
		return rondo.Detail{}, err
	}
	member, err := rondoMemberExists(ctx, tx, serverID, userID)
	if err != nil {
		return rondo.Detail{}, err
	}
	if !member {
		if err := addMemberWithinCapacity(ctx, tx, serverID, userID); err != nil {
			return rondo.Detail{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return rondo.Detail{}, err
	}
	return store.Get(ctx, actorID, serverID)
}

func ensureRondoUserExists(ctx context.Context, tx pgx.Tx, userID string) error {
	users := table.Users
	var exists bool
	err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(users.ID).FROM(users).
		WHERE(users.ID.EQ(jetUUID(userID)))))).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return rondo.ErrNotFound
	}
	return nil
}

func (store *Rondo) Leave(ctx context.Context, actorID, serverID string) ([]string, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	ownerID, err := lockRondoServerOwner(ctx, tx, serverID)
	if err != nil {
		return nil, err
	}
	if ownerID == actorID {
		return nil, rondo.ErrInvalid
	}
	member, err := rondoMemberExists(ctx, tx, serverID, actorID)
	if err != nil {
		return nil, err
	}
	if !member {
		return nil, rondo.ErrNotFound
	}
	channelIDs, err := removeRondoMember(ctx, tx, actorID, serverID)
	if err != nil {
		return nil, err
	}
	return channelIDs, tx.Commit(ctx)
}

func removeRondoMember(ctx context.Context, tx pgx.Tx, userID, serverID string) ([]string, error) {
	channelIDs, err := lockRondoConversations(ctx, tx, serverID)
	if err != nil {
		return nil, err
	}
	channels := table.RondoChannels
	conversationIDs := jetpg.SELECT(channels.ConversationID).FROM(channels).
		WHERE(channels.ServerID.EQ(jetUUID(serverID)))
	ligoMembers := table.LigoMembers
	if _, err := jetExec(ctx, tx, ligoMembers.DELETE().WHERE(jetpg.AND(
		ligoMembers.UserID.EQ(jetUUID(userID)), ligoMembers.ConversationID.IN(conversationIDs),
	))); err != nil {
		return nil, err
	}
	members := table.RondoMembers
	if _, err := jetExec(ctx, tx, members.DELETE().WHERE(jetpg.AND(
		members.ServerID.EQ(jetUUID(serverID)), members.UserID.EQ(jetUUID(userID)),
	))); err != nil {
		return nil, err
	}
	return channelIDs, nil
}
