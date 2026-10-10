package postgres

// Validates device-signed server metadata and atomically grants it to newly invited members
import (
	"context"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondo"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

func validateRondoMetadata(ctx context.Context, executor jetExecutor, ownerID, serverID, text string, public bool, ids []string, channelID string) error {
	if !strings.HasPrefix(text, encryption.TextPrefix) {
		return nil
	}
	envelope, err := encryption.ParseText(text)
	if err != nil {
		return err
	}
	context := "rondo:" + serverID
	if channelID != "" {
		context = "rondo-channel:" + serverID + ":" + channelID
	}
	if envelope.Context != context {
		return encryption.ErrInvalid
	}
	audience := encryption.Audience{Public: public, Users: make([]encryption.PublicIdentity, 0, len(ids))}
	for _, id := range ids {
		identity, err := publicEncryptionIdentity(ctx, executor, id)
		if err != nil {
			return err
		}
		audience.Users = append(audience.Users, identity)
	}
	return verifyContentForAudience(ctx, executor, ownerID, envelope, audience, context)
}
func replaceRondoMetadata(ctx context.Context, tx pgx.Tx, actorID, serverID string, input rondo.EncryptedMetadata) error {
	servers := table.RondoServers
	var name string
	if err := jetQueryRow(ctx, tx, servers.SELECT(servers.Name).WHERE(servers.ID.EQ(jetUUID(serverID)))).Scan(&name); err != nil {
		return err
	}
	if name != input.ExpectedName {
		return encryption.ErrConflict
	}
	audience, err := encryptionAudience(ctx, tx, actorID, "rondo", serverID, false)
	if err != nil {
		return err
	}
	ids := make([]string, len(audience.Users))
	for index, user := range audience.Users {
		ids[index] = user.ID
	}
	if _, err := encryption.ParseText(input.Name); err != nil {
		return err
	}
	if err := validateRondoMetadata(ctx, tx, actorID, serverID, input.Name, audience.Public, ids, ""); err != nil {
		return err
	}
	channels, err := listRondoChannels(ctx, tx, serverID)
	if err != nil {
		return err
	}
	if len(input.Channels) != len(channels) {
		return encryption.ErrConflict
	}
	for _, channel := range channels {
		value := input.Channels[channel.ID]
		if _, err := encryption.ParseText(value); err != nil {
			return err
		}
		if err := validateRondoMetadata(ctx, tx, actorID, serverID, value, audience.Public, ids, channel.ID); err != nil {
			return err
		}
		t := table.RondoChannels
		if _, err := jetExec(ctx, tx, t.UPDATE(t.Name).SET(value).WHERE(t.ID.EQ(jetUUID(channel.ID)))); err != nil {
			return err
		}
		c := table.LigoConversations
		if _, err := jetExec(ctx, tx, c.UPDATE(c.Title).SET(value).WHERE(c.ID.EQ(jetUUID(channel.ConversationID)))); err != nil {
			return err
		}
	}
	_, err = jetExec(ctx, tx, servers.UPDATE().SET(servers.Name.SET(jetpg.String(input.Name)), servers.Description.SET(jetpg.String(""))).WHERE(servers.ID.EQ(jetUUID(serverID))))
	return err
}
