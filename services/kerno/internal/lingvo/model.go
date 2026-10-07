package lingvo

// Defines private dictionaries, German card content and learning operations
import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"golang.org/x/text/unicode/norm"
)

var (
	ErrNotFound = errors.New("Lingvo resource not found")
	ErrInvalid  = errors.New("invalid Lingvo request")
	ErrConflict = errors.New("Lingvo resource changed")
	ErrExists   = errors.New("Lingvo folder already exists")
	ErrLimit    = errors.New("Lingvo capacity reached")
)

type Dictionary struct {
	ID               string    `json:"id"`
	LearningLanguage string    `json:"learningLanguage"`
	NativeLanguage   string    `json:"nativeLanguage"`
	DailyGoal        int       `json:"dailyGoal"`
	TimeZone         string    `json:"timeZone"`
	CreatedAt        time.Time `json:"createdAt"`
}

type NewDictionary struct {
	LearningLanguage string `json:"learningLanguage"`
	NativeLanguage   string `json:"nativeLanguage"`
	TimeZone         string `json:"timeZone"`
}

func (v NewDictionary) Validate() error {
	if v.LearningLanguage != "de" || (v.NativeLanguage != "en" && v.NativeLanguage != "ru") {
		return invalid("Choose German and a supported native language.")
	}
	return validZone(v.TimeZone)
}

type Settings struct {
	DailyGoal int    `json:"dailyGoal"`
	TimeZone  string `json:"timeZone"`
}

func (v Settings) Validate() error {
	if v.DailyGoal < 5 || v.DailyGoal > 200 {
		return invalid("Choose a daily goal between 5 and 200 reviews.")
	}
	return validZone(v.TimeZone)
}

type Folder struct {
	ID           string `json:"id"`
	DictionaryID string `json:"dictionaryId"`
	Name         string `json:"name"`
}

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

func (v *CardContent) Normalize() {
	for _, field := range []*string{&v.Term, &v.Translation, &v.Plural, &v.Grammar, &v.Example, &v.ExampleTranslation, &v.Notes} {
		*field = norm.NFC.String(strings.TrimSpace(*field))
	}
	if v.Status == "" {
		v.Status = "active"
	}
	if v.FolderID != nil {
		folderID := strings.ToLower(*v.FolderID)
		v.FolderID = &folderID
	}
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
	if v.FolderID != nil && !ValidID(*v.FolderID) {
		return invalid("Choose a valid folder.")
	}
	return nil
}

type Card struct {
	CardContent
	ID           string    `json:"id"`
	DictionaryID string    `json:"dictionaryId"`
	SourceKey    *string   `json:"sourceKey"`
	Schedule     Schedule  `json:"schedule"`
	Revision     int64     `json:"revision"`
	CreatedAt    time.Time `json:"createdAt"`
}

type NewCard struct {
	CardContent
	ID string `json:"id"`
}

type CardUpdate struct {
	CardContent
	Revision int64 `json:"revision"`
}

type CardFilter struct {
	Kind, Status, Search, FolderID string
	Offset, Limit                  int
}

type CardPage struct {
	Items []Card `json:"items"`
	Total int    `json:"total"`
}

type Counts struct {
	Kind      string     `json:"kind"`
	Total     int        `json:"total"`
	Due       int        `json:"due"`
	New       int        `json:"new"`
	Learning  int        `json:"learning"`
	Review    int        `json:"review"`
	Known     int        `json:"known"`
	Suspended int        `json:"suspended"`
	NextDue   *time.Time `json:"nextDue"`
}

type Activity struct {
	Day     string `json:"day"`
	Reviews int    `json:"reviews"`
}

type Overview struct {
	Dictionary   Dictionary `json:"dictionary"`
	Counts       []Counts   `json:"counts"`
	Folders      []Folder   `json:"folders"`
	Activity     []Activity `json:"activity"`
	StudiedToday int        `json:"studiedToday"`
	TotalReviews int        `json:"totalReviews"`
	Streak       int        `json:"streak"`
	Today        string     `json:"today"`
}

type Review struct {
	ID        string `json:"id"`
	Revision  int64  `json:"revision"`
	Rating    int    `json:"rating"`
	Direction string `json:"direction"`
}

func (v Review) Validate() error {
	if !ValidID(v.ID) || v.Revision < 1 || v.Rating < 1 || v.Rating > 4 {
		return invalid("Use a valid review ID, card revision and rating.")
	}
	switch v.Direction {
	case "recognition", "recall", "listening", "phrase":
		return nil
	default:
		return invalid("Choose a valid review direction.")
	}
}

type ReviewResult struct {
	ID   string `json:"id"`
	Card Card   `json:"card"`
}

type Import struct {
	SetID    string        `json:"setId"`
	CardKeys []string      `json:"cardKeys"`
	Cards    []CardContent `json:"cards"`
	FolderID *string       `json:"folderId"`
	Status   string        `json:"status"`
}

type ImportResult struct {
	Added   int `json:"added"`
	Skipped int `json:"skipped"`
}

type Store interface {
	Dictionaries(context.Context, string) ([]Dictionary, error)
	CreateDictionary(context.Context, string, NewDictionary) (Dictionary, error)
	UpdateSettings(context.Context, string, string, Settings) (Dictionary, error)
	Overview(context.Context, string, string) (Overview, error)
	Cards(context.Context, string, string, CardFilter) (CardPage, error)
	Study(context.Context, string, string, CardFilter) ([]Card, error)
	CreateCard(context.Context, string, string, NewCard) (Card, error)
	UpdateCard(context.Context, string, string, string, CardUpdate) (Card, error)
	DeleteCard(context.Context, string, string, string, int64) error
	CreateFolder(context.Context, string, string, string) (Folder, error)
	DeleteFolder(context.Context, string, string, string) error
	Import(context.Context, string, string, Import) (ImportResult, error)
	Review(context.Context, string, string, string, Review) (ReviewResult, error)
	Undo(context.Context, string, string, string) (Card, error)
}

func ValidID(v string) bool {
	id, err := uuid.Parse(v)
	return err == nil && id != uuid.Nil && id.String() == strings.ToLower(v)
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

func validZone(zone string) error {
	if !ValidText(zone, 1, 100) || zone == "Local" {
		return invalid("Choose a valid time zone.")
	}
	if _, err := time.LoadLocation(zone); err != nil {
		return invalid("Choose a valid IANA time zone.")
	}
	return nil
}

func invalid(message string) error { return fmt.Errorf("%w: %s", ErrInvalid, message) }
