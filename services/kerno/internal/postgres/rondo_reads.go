package postgres

// Reads Rondo servers, channels, and members
import (
	"context"
	"errors"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondo"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

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
	literal := escapeLikeLiteral(search)
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

func (store *Rondo) DiscoverPage(ctx context.Context, actorID, cursor string) (rondo.ServerPage, error) {
	query, servers := rondoServerQuery(actorID)
	members := table.RondoMembers.AS("membership")
	condition := jetpg.AND(servers.Access.EQ(jetpg.String("public")), jetpg.NOT(jetpg.EXISTS(
		jetpg.SELECT(members.UserID).FROM(members).WHERE(jetpg.AND(members.ServerID.EQ(servers.ID), members.UserID.EQ(jetUUID(actorID)))))))
	if cursor != "" {
		pivot := table.RondoServers.AS("pivot")
		created := jetpg.TimestampzExp(jetpg.SELECT(pivot.CreatedAt).FROM(pivot).WHERE(pivot.ID.EQ(jetUUID(cursor))))
		condition = condition.AND(servers.CreatedAt.LT(created).OR(servers.CreatedAt.EQ(created).AND(servers.ID.LT(jetUUID(cursor)))))
	}
	rows, err := jetQuery(ctx, store.pool, query.WHERE(condition).ORDER_BY(servers.CreatedAt.DESC(), servers.ID.DESC()).LIMIT(51))
	if err != nil {
		return rondo.ServerPage{}, err
	}
	defer rows.Close()
	items, err := scanRondoServers(rows)
	if err != nil {
		return rondo.ServerPage{}, err
	}
	page := rondo.ServerPage{Items: items}
	if len(items) > 50 {
		page.Items = items[:50]
		id := page.Items[49].ID
		page.NextCursor = &id
	}
	return page, nil
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

	channels, err := listRondoChannels(ctx, store.pool, serverID)
	if err != nil {
		return rondo.Detail{}, err
	}
	membersList, err := listRondoMembers(ctx, store.pool, serverID)
	if err != nil {
		return rondo.Detail{}, err
	}
	return rondo.Detail{Server: server, Channels: channels, Members: membersList}, nil
}

func listRondoChannels(ctx context.Context, executor jetExecutor, serverID string) ([]rondo.Channel, error) {
	channels := table.RondoChannels
	query := jetpg.SELECT(
		jetpg.CAST(channels.ID).AS_TEXT(), jetpg.CAST(channels.ServerID).AS_TEXT(),
		jetpg.CAST(channels.ConversationID).AS_TEXT(), channels.Name, channels.Position, channels.CreatedAt,
	).FROM(channels).WHERE(channels.ServerID.EQ(jetUUID(serverID))).ORDER_BY(channels.Position.ASC())
	rows, err := jetQuery(ctx, executor, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]rondo.Channel, 0)
	for rows.Next() {
		channel, err := scanRondoChannel(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, channel)
	}
	return items, rows.Err()
}

func listRondoMembers(ctx context.Context, executor jetExecutor, serverID string) ([]ligo.User, error) {
	members := table.RondoMembers.AS("m")
	users := table.Users.AS("u")
	query := jetpg.SELECT(jetpg.CAST(users.ID).AS_TEXT(), users.Username, users.DisplayName).
		FROM(members.INNER_JOIN(users, users.ID.EQ(members.UserID))).
		WHERE(members.ServerID.EQ(jetUUID(serverID))).
		ORDER_BY(members.JoinedAt.ASC(), users.ID.ASC()).LIMIT(100)
	rows, err := jetQuery(ctx, executor, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]ligo.User, 0)
	for rows.Next() {
		var member ligo.User
		if err := rows.Scan(&member.ID, &member.Username, &member.DisplayName); err != nil {
			return nil, err
		}
		items = append(items, member)
	}
	return items, rows.Err()
}
