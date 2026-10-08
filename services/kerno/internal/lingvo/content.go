package lingvo

// Validates German starter card content served from the embedded catalog
import (
	"errors"
	"fmt"
	"unicode"
	"unicode/utf8"
)

var ErrInvalid = errors.New("invalid Lingvo request")

type CardContent struct {
	Kind               string  `json:"kind"`
	Term               string  `json:"term"`
	Translation        string  `json:"translation"`
	PartOfSpeech       string  `json:"partOfSpeech"`
	Article            string  `json:"article"`
	Plural             string  `json:"plural"`
	Grammar            string  `json:"grammar"`
	Example            string  `json:"example"`
	ExampleTranslation string  `json:"exampleTranslation"`
	Notes              string  `json:"notes"`
	FolderID           *string `json:"folderId"`
	Status             string  `json:"status"`
}

func (v CardContent) Validate() error {
	if v.Kind != "word" && v.Kind != "phrase" {
		return invalid("Choose a word or a phrase.")
	}
	if v.Status != "active" && v.Status != "known" && v.Status != "suspended" {
		return invalid("Choose a valid card status.")
	}
	switch v.PartOfSpeech {
	case "", "noun", "verb", "adjective", "adverb", "other":
	default:
		return invalid("Choose a valid part of speech.")
	}
	if v.Article != "" && (v.Kind != "word" || v.PartOfSpeech != "noun" ||
		(v.Article != "der" && v.Article != "die" && v.Article != "das")) {
		return invalid("German noun articles must be der, die or das.")
	}
	for _, field := range []struct {
		value    string
		min, max int
	}{
		{v.Term, 1, 300}, {v.Translation, 1, 500}, {v.Plural, 0, 100}, {v.Grammar, 0, 500},
		{v.Example, 0, 500}, {v.ExampleTranslation, 0, 500}, {v.Notes, 0, 1000},
	} {
		if !ValidText(field.value, field.min, field.max) {
			return invalid("Card text is empty, too long or contains unsupported control characters.")
		}
	}
	return nil
}

func ValidText(v string, min, max int) bool {
	if !utf8.ValidString(v) {
		return false
	}
	n := utf8.RuneCountInString(v)
	if n < min || n > max {
		return false
	}
	for _, r := range v {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return false
		}
	}
	return true
}

func invalid(message string) error { return fmt.Errorf("%w: %s", ErrInvalid, message) }
