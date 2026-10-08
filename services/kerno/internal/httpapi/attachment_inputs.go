package httpapi

// Applies shared attachment identity and alt-text rules before feature-specific ownership lookups
import (
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type attachmentInputs struct {
	altTexts map[string]string
	seen     map[string]struct{}
}

func (input attachmentInputs) normalize(id string) (string, error) {
	if len(id) != 36 || uuid.Validate(id) != nil {
		return "", errors.New("Attachment IDs must be unique UUIDs.")
	}
	if _, duplicate := input.seen[id]; duplicate {
		return "", errors.New("Attachment IDs must be unique UUIDs.")
	}
	input.seen[id] = struct{}{}
	altText := strings.TrimSpace(input.altTexts[id])
	if utf8.RuneCountInString(altText) > 500 || strings.ContainsRune(altText, 0) {
		return "", errors.New("Alt text must be 500 characters or fewer.")
	}
	return altText, nil
}

func (input attachmentInputs) validateReferences() error {
	for id := range input.altTexts {
		if _, attached := input.seen[id]; !attached {
			return errors.New("Alt text must belong to an attached file.")
		}
	}
	return nil
}
