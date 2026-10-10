// Package memoro defines owner-encrypted diary days and their persistence contract.
package memoro

// Defines opaque, owner-scoped diary records with bounded encrypted envelopes
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
)

var (
	ErrInvalid  = encryption.ErrInvalid
	ErrConflict = encryption.ErrConflict
	ErrMedia    = errors.New("diary attachment unavailable")
	ErrNotFound = errors.New("diary record not found")
	ErrLimit    = errors.New("diary capacity reached")
)
var ValidTag = encryption.ValidIndex

type Envelope = encryption.PrivateEnvelope

type Summary struct {
	DayTag   string `json:"dayTag"`
	MonthTag string `json:"monthTag"`
	Revision int64  `json:"revision"`
	Envelope
}
type Media struct {
	ID   string `json:"id"`
	Size int64  `json:"size"`
	URL  string `json:"url"`
}
type Day struct {
	DayTag   string `json:"dayTag"`
	MonthTag string `json:"monthTag"`
	Revision int64  `json:"revision"`
	Envelope
	Media []Media `json:"media"`
}
type DayUpdate struct {
	MonthTag string `json:"monthTag"`
	Revision int64  `json:"revision"`
	Envelope
	Summary       Envelope `json:"summary"`
	AttachmentIDs []string `json:"attachmentIds"`
}
type Store interface {
	Month(context.Context, string, string) ([]Summary, error)
	Day(context.Context, string, string) (*Day, error)
	SaveDay(context.Context, string, string, DayUpdate, []Media) (Day, error)
}

func (input DayUpdate) Validate() error {
	if !ValidTag(input.MonthTag) || input.Revision < 0 || input.Envelope.Validate(2097152) != nil ||
		input.Summary.Validate(8192) != nil || len(input.AttachmentIDs) > 32 {
		return ErrInvalid
	}
	seen := make(map[string]bool)
	for _, id := range input.AttachmentIDs {
		if !encryption.ValidID(id) || seen[id] {
			return ErrInvalid
		}
		seen[id] = true
	}
	return nil
}

// ValidateMedia checks that the claimed uploads match the attachment IDs in order.
// Encrypted media carries at least a header, nonce and tag; the cap matches Nodo's limit.
func (input DayUpdate) ValidateMedia(media []Media) error {
	if len(media) != len(input.AttachmentIDs) {
		return ErrInvalid
	}
	for i, item := range media {
		if item.ID != input.AttachmentIDs[i] || item.Size < 17 || item.Size > 100*1024*1024 {
			return ErrInvalid
		}
	}
	return nil
}
