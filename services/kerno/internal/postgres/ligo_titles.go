package postgres

// Grants signed group titles to added members within one transaction
import (
	"context"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
)

func (s *Ligo) UpdateEncryptedTitle(ctx context.Context, actorID, id, previous, title string, added []string) (ligo.Conversation, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ligo.Conversation{}, err
	}
	defer tx.Rollback(ctx)
	creator, err := lockGroupCreator(ctx, tx, id)
	if err != nil {
		return ligo.Conversation{}, err
	}
	if creator != actorID {
		return ligo.Conversation{}, ligo.ErrForbidden
	}
	c := table.LigoConversations
	var current string
	if err := jetQueryRow(ctx, tx, c.SELECT(c.Title).WHERE(c.ID.EQ(jetUUID(id)))).Scan(&current); err != nil {
		return ligo.Conversation{}, err
	}
	if current != previous {
		return ligo.Conversation{}, encryption.ErrConflict
	}
	if len(added) > 0 {
		if _, err := addGroupMembers(ctx, tx, id, added); err != nil {
			return ligo.Conversation{}, err
		}
	}
	audience, err := encryptionAudience(ctx, tx, actorID, "ligo", id, false)
	if err != nil {
		return ligo.Conversation{}, err
	}
	envelope, err := encryption.ParseText(title)
	if err != nil || envelope.Context != "ligo-group:"+id {
		return ligo.Conversation{}, encryption.ErrInvalid
	}
	if err := verifyContentForAudience(ctx, tx, actorID, envelope, audience, envelope.Context); err != nil {
		return ligo.Conversation{}, err
	}
	if _, err := jetExec(ctx, tx, c.UPDATE(c.Title).SET(title).WHERE(c.ID.EQ(jetUUID(id)))); err != nil {
		return ligo.Conversation{}, err
	}
	if err := publishConversationActivity(ctx, tx, id); err != nil {
		return ligo.Conversation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ligo.Conversation{}, err
	}
	return s.GetConversation(ctx, actorID, id)
}
