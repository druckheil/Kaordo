package postgres

// Resolves recipient public keys through existing social and conversation access boundaries
import (
	"context"
	"errors"
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
func encryptionAudience(ctx context.Context, executor jetExecutor, actorID, module, id string, private bool) (encryption.Audience, error) {
	result := encryption.Audience{Users: make([]encryption.PublicIdentity, 0)}
	ids := []string{actorID}
	switch module {
	case "ligo":
		members := table.LigoMembers
		var allowed bool
		if err := jetQueryRow(ctx, executor, jetpg.SELECT(jetpg.EXISTS(members.SELECT(members.UserID).WHERE(jetpg.AND(members.ConversationID.EQ(jetUUID(id)), members.UserID.EQ(jetUUID(actorID))))))).Scan(&allowed); err != nil {
			return result, err
		}
		if !allowed {
			return result, encryption.ErrNotFound
		}
		rows, err := jetQuery(ctx, executor, members.SELECT(members.UserID).WHERE(members.ConversationID.EQ(jetUUID(id))).LIMIT(513))
		if err != nil {
			return result, err
		}
		defer rows.Close()
		ids = ids[:0]
		for rows.Next() {
			var member string
			if err := rows.Scan(&member); err != nil {
				return result, err
			}
			ids = append(ids, member)
		}
		if err := rows.Err(); err != nil {
			return result, err
		}
	case "ligo-history":
		messages := table.LigoMessages
		members := table.LigoMembers
		var conversationID string
		var created time.Time
		if err := jetQueryRow(ctx, executor, messages.SELECT(messages.ConversationID, messages.CreatedAt).WHERE(jetpg.AND(messages.ID.EQ(jetUUID(id)), messages.SenderID.EQ(jetUUID(actorID))))).Scan(&conversationID, &created); err != nil {
			return result, encryption.ErrNotFound
		}
		rows, err := jetQuery(ctx, executor, members.SELECT(members.UserID).WHERE(jetpg.AND(members.ConversationID.EQ(jetUUID(conversationID)), members.JoinedAt.LT_EQ(jetpg.TimestampzT(created)))).LIMIT(513))
		if err != nil {
			return result, err
		}
		defer rows.Close()
		for rows.Next() {
			var member string
			if err := rows.Scan(&member); err != nil {
				return result, err
			}
			ids = append(ids, member)
		}
		if err := rows.Err(); err != nil {
			return result, err
		}
	case "rondo":
		if id == actorID {
			result.Public = !private
			break
		}
		servers := table.RondoServers
		members := table.RondoMembers
		var access string
		err := jetQueryRow(ctx, executor, servers.SELECT(servers.Access).WHERE(jetpg.AND(servers.ID.EQ(jetUUID(id)),
			jetpg.EXISTS(members.SELECT(members.UserID).WHERE(jetpg.AND(members.ServerID.EQ(servers.ID), members.UserID.EQ(jetUUID(actorID)))))))).Scan(&access)
		if errors.Is(err, pgx.ErrNoRows) {
			return result, encryption.ErrNotFound
		}
		if err != nil {
			return result, err
		}
		result.Public = access == "public" && !private
		if !result.Public {
			rows, err := jetQuery(ctx, executor, members.SELECT(members.UserID).WHERE(members.ServerID.EQ(jetUUID(id))).LIMIT(513))
			if err != nil {
				return result, err
			}
			defer rows.Close()
			ids = ids[:0]
			for rows.Next() {
				var member string
				if err := rows.Scan(&member); err != nil {
					return result, err
				}
				ids = append(ids, member)
			}
			if err := rows.Err(); err != nil {
				return result, err
			}
		} else {
			var owner string
			if err := jetQueryRow(ctx, executor, servers.SELECT(servers.OwnerID).WHERE(servers.ID.EQ(jetUUID(id)))).Scan(&owner); err != nil {
				return result, err
			}
			ids = []string{owner}
		}
	default:
		return result, encryption.ErrInvalid
	}
	seen := map[string]bool{}
	unique := make([]string, 0, len(ids))
	for _, userID := range ids {
		if seen[userID] {
			continue
		}
		seen[userID] = true
		if len(unique) >= 512 {
			return result, encryption.ErrLimit
		}
		unique = append(unique, userID)
	}
	a := table.CryptoAccounts
	rows, err := jetQuery(ctx, executor, a.SELECT(a.UserID, a.EncryptionPublicKey, a.SigningPublicKey).WHERE(a.UserID.IN(jetUUIDList(unique)...)))
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var identity encryption.PublicIdentity
		if err := rows.Scan(&identity.ID, &identity.EncryptionPublicKey, &identity.SigningPublicKey); err != nil {
			return result, err
		}
		result.Users = append(result.Users, identity)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	if len(result.Users) != len(unique) {
		return result, encryption.ErrNotFound
	}
	return result, nil
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
