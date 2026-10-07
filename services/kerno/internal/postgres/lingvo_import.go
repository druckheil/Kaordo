package postgres

// Imports starter sets and CSV cards atomically with stable duplicate detection
import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/lingvo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
)

func (s *Lingvo) Import(ctx context.Context, actorID, dictionaryID string, input lingvo.Import) (lingvo.ImportResult, error) {
	tx, dictionary, err := s.beginDictionary(ctx, actorID, dictionaryID)
	if err != nil {
		return lingvo.ImportResult{}, err
	}
	defer tx.Rollback(ctx)
	cards, err := lingvo.ImportCards(input, dictionary.NativeLanguage)
	if err != nil {
		return lingvo.ImportResult{}, err
	}
	c := table.LingvoCards
	columns := append(lingvoContentColumns(), c.DictionaryID, c.SourceKey, c.Schedule, c.DueAt)
	query := c.INSERT(columns)
	schedule := lingvo.NewSchedule(time.Now().UTC())
	for _, card := range cards {
		if err := checkLingvoFolder(ctx, tx, dictionaryID, card.FolderID); err != nil {
			return lingvo.ImportResult{}, err
		}
		sourceKey := "catalog:" + card.ID
		if card.ID == "" {
			sourceKey = fmt.Sprintf("csv:%x", sha256.Sum256([]byte(card.Kind+"\n"+strings.ToLower(card.Term)+"\n"+strings.ToLower(card.Translation))))
		}
		values := append(lingvoContentValues(card.CardContent), jetUUID(dictionaryID), sourceKey, lingvoJSON(schedule), schedule.Due)
		query = query.VALUES(values[0], values[1:]...)
	}
	tag, err := jetExec(ctx, tx, query.ON_CONFLICT(c.DictionaryID, c.SourceKey).DO_NOTHING())
	if err != nil {
		return lingvo.ImportResult{}, err
	}
	if err := lingvoCapacity(ctx, tx, dictionaryID); err != nil {
		return lingvo.ImportResult{}, err
	}
	added := int(tag.RowsAffected())
	return lingvo.ImportResult{Added: added, Skipped: len(cards) - added}, tx.Commit(ctx)
}
