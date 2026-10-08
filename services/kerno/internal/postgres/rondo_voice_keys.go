package postgres

// Coordinates signed LiveKit room keys against a locked membership snapshot without seeing their plaintext
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondo"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"strings"
	"time"
)

func voiceMembership(ctx context.Context, executor jetExecutor, actorID, channelID string) (string, encryption.Audience, error) {
	c := table.RondoChannels
	var serverID string
	if err := jetQueryRow(ctx, executor, c.SELECT(c.ServerID).WHERE(c.ID.EQ(jetUUID(channelID)))).Scan(&serverID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			err = rondo.ErrNotFound
		}
		return "", encryption.Audience{}, err
	}
	audience, err := encryptionAudience(ctx, executor, actorID, "rondo", serverID, true, "")
	if err != nil {
		return "", audience, err
	}
	m := table.RondoMembers
	rows, err := jetQuery(ctx, executor, m.SELECT(m.UserID, m.JoinedAt).WHERE(m.ServerID.EQ(jetUUID(serverID))).ORDER_BY(m.UserID.ASC()))
	if err != nil {
		return "", audience, err
	}
	defer rows.Close()
	hash := sha256.New()
	for rows.Next() {
		var id string
		var joined time.Time
		if err := rows.Scan(&id, &joined); err != nil {
			return "", audience, err
		}
		hash.Write([]byte(id + "\n" + joined.UTC().Format(time.RFC3339Nano) + "\n"))
	}
	if err := rows.Err(); err != nil {
		return "", audience, err
	}
	return hex.EncodeToString(hash.Sum(nil)), audience, nil
}
func voiceKey(ctx context.Context, executor jetExecutor, channelID, tag string) (rondo.VoiceKey, error) {
	result := rondo.VoiceKey{MembershipTag: tag}
	t := table.RondoVoiceKeys
	var storedTag string
	var envelope []byte
	err := jetQueryRow(ctx, executor, t.SELECT(t.Revision, t.MembershipTag, t.Envelope).WHERE(t.ChannelID.EQ(jetUUID(channelID)))).Scan(&result.Revision, &storedTag, &envelope)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	if storedTag == tag {
		result.Envelope = envelope
	}
	return result, nil
}
func (s *Rondo) VoiceKey(ctx context.Context, actorID, channelID string) (rondo.VoiceKey, error) {
	tag, _, err := voiceMembership(ctx, s.pool, actorID, channelID)
	if err != nil {
		return rondo.VoiceKey{}, err
	}
	return voiceKey(ctx, s.pool, channelID, tag)
}
func (s *Rondo) SetVoiceKey(ctx context.Context, actorID, channelID string, input rondo.VoiceKey) (rondo.VoiceKey, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return rondo.VoiceKey{}, err
	}
	defer tx.Rollback(ctx)
	c := table.RondoChannels
	var serverID string
	if err := jetQueryRow(ctx, tx, c.SELECT(c.ServerID).WHERE(c.ID.EQ(jetUUID(channelID)))).Scan(&serverID); err != nil {
		return rondo.VoiceKey{}, rondo.ErrNotFound
	}
	if _, err := lockRondoServerOwner(ctx, tx, serverID); err != nil {
		return rondo.VoiceKey{}, err
	}
	tag, audience, err := voiceMembership(ctx, tx, actorID, channelID)
	if err != nil {
		return rondo.VoiceKey{}, err
	}
	previous, err := voiceKey(ctx, tx, channelID, tag)
	if err != nil {
		return rondo.VoiceKey{}, err
	}
	if previous.MembershipTag != input.MembershipTag || previous.Revision != input.Revision || len(previous.Envelope) != 0 {
		return rondo.VoiceKey{}, encryption.ErrConflict
	}
	envelope, err := encryption.ParseContent(input.Envelope)
	context := "rondo-voice:" + channelID + ":" + tag
	if err != nil || envelope.Context != context || strings.Contains(envelope.Context, "\n") {
		return rondo.VoiceKey{}, encryption.ErrInvalid
	}
	if err := verifyContentForAudience(ctx, tx, actorID, envelope, audience, context); err != nil {
		return rondo.VoiceKey{}, err
	}
	t := table.RondoVoiceKeys
	if _, err := jetExec(ctx, tx, t.INSERT(t.ChannelID, t.Revision, t.MembershipTag, t.Envelope).VALUES(jetUUID(channelID), jetpg.Int(input.Revision+1), jetpg.String(tag), jetpg.Json([]byte(input.Envelope))).ON_CONFLICT(t.ChannelID).
		DO_UPDATE(jetpg.SET(t.Revision.SET(t.EXCLUDED.Revision), t.MembershipTag.SET(t.EXCLUDED.MembershipTag), t.Envelope.SET(t.EXCLUDED.Envelope)))); err != nil {
		return rondo.VoiceKey{}, err
	}
	input.Revision++
	if err := tx.Commit(ctx); err != nil {
		return rondo.VoiceKey{}, err
	}
	return input, nil
}
