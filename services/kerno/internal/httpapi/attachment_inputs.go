package httpapi

// Applies shared attachment identity and alt-text rules before feature-specific ownership lookups
import (
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/invalid"
	"github.com/google/uuid"
)

var errInvalidAttachment = errors.New("invalid attachment")

type attachmentInputs struct {
	altTexts map[string]string
	seen     map[string]struct{}
}

func (input attachmentInputs) normalize(id string) (string, error) {
	if len(id) != 36 || uuid.Validate(id) != nil {
		return "", invalid.Input(errInvalidAttachment, "Attachment IDs must be unique UUIDs.")
	}
	if _, duplicate := input.seen[id]; duplicate {
		return "", invalid.Input(errInvalidAttachment, "Attachment IDs must be unique UUIDs.")
	}
	input.seen[id] = struct{}{}
	altText := strings.TrimSpace(input.altTexts[id])
	if utf8.RuneCountInString(altText) > 500 || strings.ContainsRune(altText, 0) {
		return "", invalid.Input(errInvalidAttachment, "Alt text must be 500 characters or fewer.")
	}
	return altText, nil
}

func (input attachmentInputs) validateReferences() error {
	for id := range input.altTexts {
		if _, attached := input.seen[id]; !attached {
			return invalid.Input(errInvalidAttachment, "Alt text must belong to an attached file.")
		}
	}
	return nil
}
