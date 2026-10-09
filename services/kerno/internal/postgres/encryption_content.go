package postgres

// Resolves recipient public keys through existing social and conversation access boundaries
import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func publicEncryptionIdentity(ctx context.Context, executor jetExecutor, userID string) (encryption.PublicIdentity, error) {
	a := table.CryptoAccounts
	user := table.Users
	var item encryption.PublicIdentity
	err := jetQueryRow(ctx, executor, a.SELECT(a.UserID, a.EncryptionPublicKey, a.SigningPublicKey).
		FROM(a.INNER_JOIN(user, user.ID.EQ(a.UserID))).WHERE(a.UserID.EQ(jetUUID(userID)))).
		Scan(&item.ID, &item.EncryptionPublicKey, &item.SigningPublicKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, encryption.ErrNotFound
	}
	return item, err
}
func (s *Encryption) PublicIdentity(ctx context.Context, userID string) (encryption.PublicIdentity, error) {
	return publicEncryptionIdentity(ctx, s.pool, userID)
}
func (s *Encryption) Audience(ctx context.Context, actorID, module, id string, private bool) (encryption.Audience, error) {
	return encryptionAudience(ctx, s.pool, actorID, module, id, private)
}

// maxAudience bounds how many accounts one content key may be sealed to
const maxAudience = 512

// encryptionAudience lists who must receive a content key: the members of a Ligo
// conversation, the members present when a message was sent, or a Rondo server's audience
func encryptionAudience(ctx context.Context, executor jetExecutor, actorID, module, id string, private bool) (encryption.Audience, error) {
	var (
		audience encryption.Audience
		ids      []string
		err      error
	)
	switch module {
	case "ligo":
		ids, err = ligoAudience(ctx, executor, actorID, id)
	case "ligo-history":
		ids, err = ligoHistoryAudience(ctx, executor, actorID, id)
	case "rondo":
		audience.Public, ids, err = rondoAudience(ctx, executor, actorID, id, private)
	default:
		return audience, encryption.ErrInvalid
	}
	if err != nil {
		return audience, err
	}
	audience.Users, err = audienceIdentities(ctx, executor, ids)
	return audience, err
}

func ligoAudience(ctx context.Context, executor jetExecutor, actorID, conversationID string) ([]string, error) {
	members := table.LigoMembers
	var allowed bool
	membership := members.SELECT(members.UserID).WHERE(jetpg.AND(
		members.ConversationID.EQ(jetUUID(conversationID)), members.UserID.EQ(jetUUID(actorID))))
	if err := jetQueryRow(ctx, executor, jetpg.SELECT(jetpg.EXISTS(membership))).Scan(&allowed); err != nil {
		return nil, err
	}
	if !allowed {
		return nil, encryption.ErrNotFound
	}
	return queryUserIDs(ctx, executor, members.SELECT(members.UserID).
		WHERE(members.ConversationID.EQ(jetUUID(conversationID))).LIMIT(maxAudience+1))
}

// ligoHistoryAudience covers re-encrypting the actor's own message for the members who could see it
func ligoHistoryAudience(ctx context.Context, executor jetExecutor, actorID, messageID string) ([]string, error) {
	messages, members := table.LigoMessages, table.LigoMembers
	var conversationID string
	var created time.Time
	if err := jetQueryRow(ctx, executor, messages.SELECT(messages.ConversationID, messages.CreatedAt).
		WHERE(jetpg.AND(messages.ID.EQ(jetUUID(messageID)), messages.SenderID.EQ(jetUUID(actorID))))).
		Scan(&conversationID, &created); err != nil {
		return nil, encryption.ErrNotFound
	}
	earlier, err := queryUserIDs(ctx, executor, members.SELECT(members.UserID).WHERE(jetpg.AND(
		members.ConversationID.EQ(jetUUID(conversationID)), members.JoinedAt.LT_EQ(jetpg.TimestampzT(created)))).
		LIMIT(maxAudience+1))
	return append([]string{actorID}, earlier...), err
}

// rondoAudience seals private servers to their members; public servers need only the owner's key.
// An id equal to the actor addresses the actor's own server list.
func rondoAudience(ctx context.Context, executor jetExecutor, actorID, serverID string, private bool) (bool, []string, error) {
	if serverID == actorID {
		return !private, []string{actorID}, nil
	}
	servers, members := table.RondoServers, table.RondoMembers
	var access, owner string
	err := jetQueryRow(ctx, executor, servers.SELECT(servers.Access, servers.OwnerID).WHERE(jetpg.AND(
		servers.ID.EQ(jetUUID(serverID)),
		jetpg.EXISTS(members.SELECT(members.UserID).WHERE(jetpg.AND(
			members.ServerID.EQ(servers.ID), members.UserID.EQ(jetUUID(actorID)))))))).Scan(&access, &owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil, encryption.ErrNotFound
	}
	if err != nil {
		return false, nil, err
	}
	if access == "public" && !private {
		return true, []string{owner}, nil
	}
	ids, err := queryUserIDs(ctx, executor, members.SELECT(members.UserID).
		WHERE(members.ServerID.EQ(jetUUID(serverID))).LIMIT(maxAudience+1))
	return false, ids, err
}

// audienceIdentities resolves unique account IDs to public keys; every account must have keys
func audienceIdentities(ctx context.Context, executor jetExecutor, ids []string) ([]encryption.PublicIdentity, error) {
	unique := slices.Compact(slices.Sorted(slices.Values(ids)))
	if len(unique) > maxAudience {
		return nil, encryption.ErrLimit
	}
	accounts := table.CryptoAccounts
	rows, err := jetQuery(ctx, executor, accounts.SELECT(accounts.UserID, accounts.EncryptionPublicKey, accounts.SigningPublicKey).
		WHERE(accounts.UserID.IN(jetUUIDList(unique)...)))
	if err != nil {
		return nil, err
	}
	identities, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (encryption.PublicIdentity, error) {
		var identity encryption.PublicIdentity
		err := row.Scan(&identity.ID, &identity.EncryptionPublicKey, &identity.SigningPublicKey)
		return identity, err
	})
	if err != nil {
		return nil, err
	}
	if len(identities) != len(unique) {
		return nil, encryption.ErrNotFound
	}
	return identities, nil
}

func queryUserIDs(ctx context.Context, executor jetExecutor, statement jetStatement) ([]string, error) {
	rows, err := jetQuery(ctx, executor, statement)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func verifyContentForAudience(ctx context.Context, executor jetExecutor, actorID string, envelope encryption.ContentEnvelope, audience encryption.Audience, contextPrefix string) error {
	if !strings.HasPrefix(envelope.Context, contextPrefix) || (envelope.PublicKey != "") != audience.Public {
		return encryption.ErrInvalid
	}
	identity, err := publicEncryptionIdentity(ctx, executor, actorID)
	if err != nil {
		return err
	}
	if err := envelope.Verify(actorID, identity.SigningPublicKey); err != nil {
		return err
	}
	allowed := map[string]bool{}
	for _, item := range audience.Users {
		allowed[item.ID] = true
	}
	for _, key := range envelope.Keys {
		if !allowed[key.UserID] {
			return encryption.ErrInvalid
		}
		delete(allowed, key.UserID)
	}
	if len(allowed) != 0 {
		return encryption.ErrConflict
	}
	return nil
}
