package postgres

// Creates Rondo text channels and resolves member voice channels
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondo"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

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
	channel, err = scanRondoChannel(jetQueryRow(ctx, tx, channels.INSERT(channels.ServerID, channels.ConversationID, channels.Name, channels.Position).
		VALUES(jetUUID(serverID), jetUUID(conversationID), jetpg.String(name), position).
		RETURNING(jetpg.CAST(channels.ID).AS_TEXT(), jetpg.CAST(channels.ServerID).AS_TEXT(),
			jetpg.CAST(channels.ConversationID).AS_TEXT(), channels.Name, channels.Position, channels.CreatedAt)))
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

func (store *Rondo) CreateChannel(ctx context.Context, actorID, serverID, name string) (rondo.Channel, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return rondo.Channel{}, err
	}
	defer tx.Rollback(ctx)
	ownerID, err := lockRondoServerOwner(ctx, tx, serverID)
	if err != nil {
		return rondo.Channel{}, err
	}
	if ownerID != actorID {
		return rondo.Channel{}, rondo.ErrForbidden
	}
	if err := enforceRondoChannelLimit(ctx, tx, serverID); err != nil {
		return rondo.Channel{}, err
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

func enforceRondoChannelLimit(ctx context.Context, tx pgx.Tx, serverID string) error {
	channels := table.RondoChannels
	var count int
	if err := jetQueryRow(ctx, tx, jetpg.SELECT(jetpg.COUNT(channels.ID)).FROM(channels).
		WHERE(channels.ServerID.EQ(jetUUID(serverID)))).Scan(&count); err != nil {
		return err
	}
	if count >= 100 {
		return rondo.ErrLimit
	}
	return nil
}

func isRondoUnique(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func (store *Rondo) VoiceChannel(ctx context.Context, actorID, channelID string) (rondo.Channel, error) {
	channels := table.RondoChannels.AS("c")
	members := table.RondoMembers.AS("m")
	query := jetpg.SELECT(jetpg.CAST(channels.ID).AS_TEXT(), jetpg.CAST(channels.ServerID).AS_TEXT(),
		jetpg.CAST(channels.ConversationID).AS_TEXT(), channels.Name, channels.Position, channels.CreatedAt).
		FROM(channels.INNER_JOIN(members, jetpg.AND(members.ServerID.EQ(channels.ServerID),
			members.UserID.EQ(jetUUID(actorID))))).WHERE(channels.ID.EQ(jetUUID(channelID)))
	channel, err := scanRondoChannel(jetQueryRow(ctx, store.pool, query))
	if errors.Is(err, pgx.ErrNoRows) {
		return rondo.Channel{}, rondo.ErrNotFound
	}
	return channel, err
}

func scanRondoChannel(row pgx.Row) (rondo.Channel, error) {
	var channel rondo.Channel
	err := row.Scan(&channel.ID, &channel.ServerID, &channel.ConversationID,
		&channel.Name, &channel.Position, &channel.CreatedAt)
	return channel, err
}
