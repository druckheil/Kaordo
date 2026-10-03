package postgres

import (
	"context"
	"errors"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondo"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Rondo struct{ pool *pgxpool.Pool }

func NewRondo(pool *pgxpool.Pool) *Rondo { return &Rondo{pool: pool} }

func rondoServerQuery(actorID string) (jetpg.SelectStatement, *table.RondoServersTable) {
	servers := table.RondoServers.AS("s")
	members := table.RondoMembers.AS("m")
	mine := table.RondoMembers.AS("mine")
	memberCount := jetpg.IntExp(jetpg.SELECT(jetpg.COUNT(members.UserID)).
		FROM(members).WHERE(members.ServerID.EQ(servers.ID)))
	joined := jetpg.EXISTS(jetpg.SELECT(mine.UserID).
		FROM(mine).WHERE(jetpg.AND(mine.ServerID.EQ(servers.ID), mine.UserID.EQ(jetUUID(actorID)))))
	query := jetpg.SELECT(
		jetpg.CAST(servers.ID).AS_TEXT(), servers.Name, servers.Description, servers.Access,
		jetpg.CAST(servers.OwnerID).AS_TEXT(), memberCount, joined, servers.CreatedAt,
	).FROM(servers)
	return query, servers
}

func rondoNameMatches(servers *table.RondoServersTable, search string) jetpg.BoolExpression {
	if search == "" {
		return jetpg.Bool(true)
	}
	literal := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(search)
	return jetpg.LOWER(servers.Name).LIKE(jetpg.String("%" + strings.ToLower(literal) + "%"))
}

func scanRondoServer(row pgx.Row) (rondo.Server, error) {
	var item rondo.Server
	err := row.Scan(&item.ID, &item.Name, &item.Description, &item.Access, &item.OwnerID,
		&item.MemberCount, &item.Joined, &item.CreatedAt)
	return item, err
}

func scanRondoServers(rows pgx.Rows) ([]rondo.Server, error) {
	items := make([]rondo.Server, 0)
	for rows.Next() {
		item, err := scanRondoServer(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *Rondo) List(ctx context.Context, actorID, search string) ([]rondo.Server, error) {
	query, servers := rondoServerQuery(actorID)
	members := table.RondoMembers.AS("membership")
	query = query.WHERE(jetpg.AND(
		jetpg.EXISTS(jetpg.SELECT(members.UserID).FROM(members).WHERE(jetpg.AND(
			members.ServerID.EQ(servers.ID), members.UserID.EQ(jetUUID(actorID)),
		))),
		rondoNameMatches(servers, search),
	)).ORDER_BY(servers.CreatedAt.DESC(), servers.ID.DESC()).LIMIT(100)
	rows, err := jetQuery(ctx, store.pool, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRondoServers(rows)
}

func (store *Rondo) Discover(ctx context.Context, actorID, search string) ([]rondo.Server, error) {
	query, servers := rondoServerQuery(actorID)
	members := table.RondoMembers.AS("membership")
	query = query.WHERE(jetpg.AND(
		servers.Access.EQ(jetpg.String("public")),
		jetpg.NOT(jetpg.EXISTS(jetpg.SELECT(members.UserID).FROM(members).WHERE(jetpg.AND(
			members.ServerID.EQ(servers.ID), members.UserID.EQ(jetUUID(actorID)),
		)))),
		rondoNameMatches(servers, search),
	)).ORDER_BY(servers.CreatedAt.DESC(), servers.ID.DESC()).LIMIT(50)
	rows, err := jetQuery(ctx, store.pool, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRondoServers(rows)
}

func (store *Rondo) Get(ctx context.Context, actorID, serverID string) (rondo.Detail, error) {
	query, servers := rondoServerQuery(actorID)
	members := table.RondoMembers.AS("membership")
	query = query.WHERE(jetpg.AND(
		servers.ID.EQ(jetUUID(serverID)),
		jetpg.EXISTS(jetpg.SELECT(members.UserID).FROM(members).WHERE(jetpg.AND(
			members.ServerID.EQ(servers.ID), members.UserID.EQ(jetUUID(actorID)),
		))),
	))
	server, err := scanRondoServer(jetQueryRow(ctx, store.pool, query))
	if errors.Is(err, pgx.ErrNoRows) {
		return rondo.Detail{}, rondo.ErrNotFound
	}
	if err != nil {
		return rondo.Detail{}, err
	}
	detail := rondo.Detail{Server: server, Channels: make([]rondo.Channel, 0), Members: make([]ligo.User, 0)}
	channels := table.RondoChannels
	rows, err := jetQuery(ctx, store.pool, jetpg.SELECT(
		jetpg.CAST(channels.ID).AS_TEXT(), jetpg.CAST(channels.ServerID).AS_TEXT(),
		jetpg.CAST(channels.ConversationID).AS_TEXT(), channels.Name, channels.Position, channels.CreatedAt,
	).FROM(channels).WHERE(channels.ServerID.EQ(jetUUID(serverID))).ORDER_BY(channels.Position.ASC()))
	if err != nil {
		return rondo.Detail{}, err
	}
	for rows.Next() {
		var channel rondo.Channel
		if err := rows.Scan(&channel.ID, &channel.ServerID, &channel.ConversationID,
			&channel.Name, &channel.Position, &channel.CreatedAt); err != nil {
			rows.Close()
			return rondo.Detail{}, err
		}
		detail.Channels = append(detail.Channels, channel)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return rondo.Detail{}, err
	}
	rows.Close()
	serverMembers := table.RondoMembers.AS("m")
	users := table.Users.AS("u")
	rows, err = jetQuery(ctx, store.pool, jetpg.SELECT(
		jetpg.CAST(users.ID).AS_TEXT(), users.Username, users.DisplayName,
	).FROM(serverMembers.INNER_JOIN(users, users.ID.EQ(serverMembers.UserID))).
		WHERE(serverMembers.ServerID.EQ(jetUUID(serverID))).
		ORDER_BY(serverMembers.JoinedAt.ASC(), users.ID.ASC()).LIMIT(100))
	if err != nil {
		return rondo.Detail{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var member ligo.User
		if err := rows.Scan(&member.ID, &member.Username, &member.DisplayName); err != nil {
			return rondo.Detail{}, err
		}
		detail.Members = append(detail.Members, member)
	}
	return detail, rows.Err()
}

func insertRondoChannel(ctx context.Context, tx pgx.Tx, serverID, ownerID, name string) (rondo.Channel, error) {
	var channel rondo.Channel
	var conversationID string
	conversations := table.LigoConversations
	err := jetQueryRow(ctx, tx, conversations.INSERT(conversations.Kind, conversations.Title, conversations.CreatedBy).
		VALUES(jetpg.String("channel"), jetpg.String(name), jetUUID(ownerID)).
		RETURNING(jetpg.CAST(conversations.ID).AS_TEXT())).Scan(&conversationID)
	if err != nil {
		return channel, err
	}
	channels := table.RondoChannels
	position := jetpg.IntExp(jetpg.SELECT(jetpg.COUNT(channels.ID)).FROM(channels).
		WHERE(channels.ServerID.EQ(jetUUID(serverID))))
	err = jetQueryRow(ctx, tx, channels.INSERT(channels.ServerID, channels.ConversationID, channels.Name, channels.Position).
		VALUES(jetUUID(serverID), jetUUID(conversationID), jetpg.String(name), position).
		RETURNING(jetpg.CAST(channels.ID).AS_TEXT(), jetpg.CAST(channels.ServerID).AS_TEXT(),
			jetpg.CAST(channels.ConversationID).AS_TEXT(), channels.Name, channels.Position, channels.CreatedAt)).
		Scan(&channel.ID, &channel.ServerID, &channel.ConversationID,
			&channel.Name, &channel.Position, &channel.CreatedAt)
	if err != nil {
		return channel, err
	}
	serverMembers := table.RondoMembers.AS("server_members")
	conversationMembers := table.LigoMembers
	_, err = jetExec(ctx, tx, conversationMembers.INSERT(conversationMembers.ConversationID,
		conversationMembers.UserID, conversationMembers.JoinedAt).QUERY(jetpg.SELECT(
		jetUUID(conversationID), serverMembers.UserID, jetpg.RawTimestampz("clock_timestamp()"),
	).FROM(serverMembers).WHERE(serverMembers.ServerID.EQ(jetUUID(serverID)))))
	return channel, err
}

func (store *Rondo) Create(ctx context.Context, actorID string, input rondo.NewServer) (rondo.Detail, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return rondo.Detail{}, err
	}
	defer tx.Rollback(ctx)
	var locked string
	if err := jetQueryRow(ctx, tx, table.Users.SELECT(jetpg.CAST(table.Users.ID).AS_TEXT()).
		WHERE(table.Users.ID.EQ(jetUUID(actorID))).FOR(jetpg.UPDATE())).Scan(&locked); err != nil {
		return rondo.Detail{}, err
	}
	var owned int
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(table.RondoServers.ID)).FROM(table.RondoServers).
		WHERE(table.RondoServers.OwnerID.EQ(jetUUID(actorID)))).Scan(&owned); err != nil {
		return rondo.Detail{}, err
	}
	if owned >= 20 {
		return rondo.Detail{}, rondo.ErrLimit
	}
	if err := checkRondoUserLimit(ctx, tx, actorID); err != nil {
		return rondo.Detail{}, err
	}
	var id string
	servers := table.RondoServers
	err = jetQueryRow(ctx, tx, servers.INSERT(servers.Name, servers.Description, servers.Access, servers.OwnerID).
		VALUES(jetpg.String(input.Name), jetpg.String(input.Description), jetpg.String(input.Access), jetUUID(actorID)).
		RETURNING(jetpg.CAST(servers.ID).AS_TEXT())).Scan(&id)
	if err != nil {
		return rondo.Detail{}, err
	}
	members := table.RondoMembers
	if _, err = jetExec(ctx, tx, members.INSERT(members.ServerID, members.UserID).
		VALUES(jetUUID(id), jetUUID(actorID))); err != nil {
		return rondo.Detail{}, err
	}
	if _, err = insertRondoChannel(ctx, tx, id, actorID, "general"); err != nil {
		return rondo.Detail{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return rondo.Detail{}, err
	}
	return store.Get(ctx, actorID, id)
}

func (store *Rondo) Join(ctx context.Context, actorID, serverID string) (rondo.Detail, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return rondo.Detail{}, err
	}
	defer tx.Rollback(ctx)
	var access string
	servers := table.RondoServers
	err = jetQueryRow(ctx, tx, servers.SELECT(servers.Access).
		WHERE(servers.ID.EQ(jetUUID(serverID))).FOR(jetpg.UPDATE())).Scan(&access)
	if errors.Is(err, pgx.ErrNoRows) {
		return rondo.Detail{}, rondo.ErrNotFound
	}
	if err != nil {
		return rondo.Detail{}, err
	}
	var exists bool
	members := table.RondoMembers
	if err = jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(members.UserID).
		FROM(members).WHERE(jetpg.AND(members.ServerID.EQ(jetUUID(serverID)), members.UserID.EQ(jetUUID(actorID))))))).
		Scan(&exists); err != nil {
		return rondo.Detail{}, err
	}
	if !exists {
		if access != "public" {
			return rondo.Detail{}, rondo.ErrForbidden
		}
		if err := checkRondoMemberLimit(ctx, tx, serverID); err != nil {
			return rondo.Detail{}, err
		}
		if err := checkRondoUserLimit(ctx, tx, actorID); err != nil {
			return rondo.Detail{}, err
		}
		if err = addRondoMember(ctx, tx, serverID, actorID); err != nil {
			return rondo.Detail{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return rondo.Detail{}, err
	}
	return store.Get(ctx, actorID, serverID)
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
	var locked string
	if err := jetQueryRow(ctx, tx, table.Users.SELECT(jetpg.CAST(table.Users.ID).AS_TEXT()).
		WHERE(table.Users.ID.EQ(jetUUID(userID))).FOR(jetpg.UPDATE())).Scan(&locked); err != nil {
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

// Ligo sends lock the conversation before checking membership. Take the same
// locks while changing server membership so message timestamps and join times
// have one consistent order, even when a send runs concurrently.
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
	_, err := jetExec(ctx, tx, members.INSERT(members.ServerID, members.UserID).
		VALUES(jetUUID(serverID), jetUUID(userID)))
	if err != nil {
		return err
	}
	if _, err = lockRondoConversations(ctx, tx, serverID); err != nil {
		return err
	}
	channels := table.RondoChannels.AS("channel")
	ligoMembers := table.LigoMembers
	_, err = jetExec(ctx, tx, ligoMembers.INSERT(ligoMembers.ConversationID, ligoMembers.UserID, ligoMembers.JoinedAt).
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
	var ownerID string
	servers := table.RondoServers
	err = jetQueryRow(ctx, tx, servers.SELECT(jetpg.CAST(servers.OwnerID).AS_TEXT()).
		WHERE(servers.ID.EQ(jetUUID(serverID))).FOR(jetpg.UPDATE())).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return rondo.Detail{}, rondo.ErrNotFound
	}
	if err != nil {
		return rondo.Detail{}, err
	}
	if ownerID != actorID {
		return rondo.Detail{}, rondo.ErrForbidden
	}
	var exists bool
	if err = jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(table.Users.ID).
		FROM(table.Users).WHERE(table.Users.ID.EQ(jetUUID(userID)))))).Scan(&exists); err != nil {
		return rondo.Detail{}, err
	}
	if !exists {
		return rondo.Detail{}, rondo.ErrNotFound
	}
	members := table.RondoMembers
	if err = jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(members.UserID).FROM(members).
		WHERE(jetpg.AND(members.ServerID.EQ(jetUUID(serverID)), members.UserID.EQ(jetUUID(userID))))))).
		Scan(&exists); err != nil {
		return rondo.Detail{}, err
	}
	if !exists {
		if err := checkRondoMemberLimit(ctx, tx, serverID); err != nil {
			return rondo.Detail{}, err
		}
		if err := checkRondoUserLimit(ctx, tx, userID); err != nil {
			return rondo.Detail{}, err
		}
		if err = addRondoMember(ctx, tx, serverID, userID); err != nil {
			return rondo.Detail{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return rondo.Detail{}, err
	}
	return store.Get(ctx, actorID, serverID)
}

func (store *Rondo) Leave(ctx context.Context, actorID, serverID string) ([]string, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var ownerID string
	servers := table.RondoServers
	err = jetQueryRow(ctx, tx, servers.SELECT(jetpg.CAST(servers.OwnerID).AS_TEXT()).
		WHERE(servers.ID.EQ(jetUUID(serverID))).FOR(jetpg.UPDATE())).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, rondo.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if ownerID == actorID {
		return nil, rondo.ErrInvalid
	}
	var member bool
	members := table.RondoMembers
	if err = jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.EXISTS(jetpg.SELECT(members.UserID).FROM(members).
		WHERE(jetpg.AND(members.ServerID.EQ(jetUUID(serverID)), members.UserID.EQ(jetUUID(actorID))))))).
		Scan(&member); err != nil {
		return nil, err
	}
	if !member {
		return nil, rondo.ErrNotFound
	}
	channels, err := lockRondoConversations(ctx, tx, serverID)
	if err != nil {
		return nil, err
	}
	channelsTable := table.RondoChannels
	ligoMembers := table.LigoMembers
	conversationIDs := jetpg.SELECT(channelsTable.ConversationID).FROM(channelsTable).
		WHERE(channelsTable.ServerID.EQ(jetUUID(serverID)))
	if _, err = jetExec(ctx, tx, ligoMembers.DELETE().WHERE(jetpg.AND(
		ligoMembers.UserID.EQ(jetUUID(actorID)), ligoMembers.ConversationID.IN(conversationIDs),
	))); err != nil {
		return nil, err
	}
	if _, err = jetExec(ctx, tx, members.DELETE().WHERE(jetpg.AND(
		members.ServerID.EQ(jetUUID(serverID)), members.UserID.EQ(jetUUID(actorID)),
	))); err != nil {
		return nil, err
	}
	return channels, tx.Commit(ctx)
}

func (store *Rondo) CreateChannel(ctx context.Context, actorID, serverID, name string) (rondo.Channel, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return rondo.Channel{}, err
	}
	defer tx.Rollback(ctx)
	var ownerID string
	servers := table.RondoServers
	err = jetQueryRow(ctx, tx, servers.SELECT(jetpg.CAST(servers.OwnerID).AS_TEXT()).
		WHERE(servers.ID.EQ(jetUUID(serverID))).FOR(jetpg.UPDATE())).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return rondo.Channel{}, rondo.ErrNotFound
	}
	if err != nil {
		return rondo.Channel{}, err
	}
	if ownerID != actorID {
		return rondo.Channel{}, rondo.ErrForbidden
	}
	var channels int
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(table.RondoChannels.ID)).
		FROM(table.RondoChannels).WHERE(table.RondoChannels.ServerID.EQ(jetUUID(serverID)))).Scan(&channels); err != nil {
		return rondo.Channel{}, err
	}
	if channels >= 100 {
		return rondo.Channel{}, rondo.ErrLimit
	}
	channel, err := insertRondoChannel(ctx, tx, serverID, actorID, name)
	if isRondoUnique(err) {
		return rondo.Channel{}, rondo.ErrConflict
	}
	if err != nil {
		return rondo.Channel{}, err
	}
	return channel, tx.Commit(ctx)
}

func isRondoUnique(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func (store *Rondo) VoiceChannel(ctx context.Context, actorID, channelID string) (rondo.Channel, error) {
	var channel rondo.Channel
	channels := table.RondoChannels.AS("c")
	members := table.RondoMembers.AS("m")
	query := jetpg.SELECT(jetpg.CAST(channels.ID).AS_TEXT(), jetpg.CAST(channels.ServerID).AS_TEXT(),
		jetpg.CAST(channels.ConversationID).AS_TEXT(), channels.Name, channels.Position, channels.CreatedAt).
		FROM(channels.INNER_JOIN(members, jetpg.AND(members.ServerID.EQ(channels.ServerID),
			members.UserID.EQ(jetUUID(actorID))))).WHERE(channels.ID.EQ(jetUUID(channelID)))
	err := jetQueryRow(ctx, store.pool, query).Scan(&channel.ID, &channel.ServerID,
		&channel.ConversationID, &channel.Name, &channel.Position, &channel.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return rondo.Channel{}, rondo.ErrNotFound
	}
	return channel, err
}
