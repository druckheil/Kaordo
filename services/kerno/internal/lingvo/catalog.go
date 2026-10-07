package lingvo

// Loads original German starter sets and resolves their native-language translations
import (
	_ "embed"
	"encoding/json"
)

//go:embed catalog/de.json
var germanCatalog []byte

type CatalogCard struct {
	CardContent
	ID string `json:"id"`
}

type CatalogSet struct {
	ID          string        `json:"id"`
	Title       string        `json:"title"`
	Description string        `json:"description"`
	Kind        string        `json:"kind"`
	Level       string        `json:"level"`
	Cards       []CatalogCard `json:"cards"`
}

type catalogEntry struct {
	ID                 string            `json:"id"`
	Term               string            `json:"term"`
	Translation        map[string]string `json:"translation"`
	PartOfSpeech       string            `json:"partOfSpeech"`
	Article            string            `json:"article"`
	Plural             string            `json:"plural"`
	Grammar            string            `json:"grammar"`
	Example            string            `json:"example"`
	ExampleTranslation map[string]string `json:"exampleTranslation"`
}

type catalogPack struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Kind        string         `json:"kind"`
	Level       string         `json:"level"`
	Cards       []catalogEntry `json:"cards"`
}

func Catalog(nativeLanguage string) ([]CatalogSet, error) {
	if nativeLanguage != "en" && nativeLanguage != "ru" {
		return nil, ErrInvalid
	}
	var packs []catalogPack
	if err := json.Unmarshal(germanCatalog, &packs); err != nil {
		return nil, err
	}
	sets := make([]CatalogSet, 0, len(packs))
	for _, pack := range packs {
		set := CatalogSet{ID: pack.ID, Title: pack.Title, Description: pack.Description, Kind: pack.Kind, Level: pack.Level, Cards: make([]CatalogCard, 0, len(pack.Cards))}
		for _, entry := range pack.Cards {
			card := CatalogCard{ID: entry.ID, CardContent: CardContent{Kind: pack.Kind, Term: entry.Term,
				Translation: entry.Translation[nativeLanguage], PartOfSpeech: entry.PartOfSpeech, Article: entry.Article,
				Plural: entry.Plural, Grammar: entry.Grammar, Example: entry.Example,
				ExampleTranslation: entry.ExampleTranslation[nativeLanguage], Status: "active"}}
			if err := card.Validate(); err != nil {
				return nil, err
			}
			set.Cards = append(set.Cards, card)
		}
		sets = append(sets, set)
	}
	return sets, nil
}

func ImportCards(input Import, nativeLanguage string) ([]CatalogCard, error) {
	if (input.SetID == "") == (len(input.Cards) == 0) {
		return nil, invalid("Choose a starter set or supply cards to import.")
	}
	if len(input.Cards) > 500 || len(input.CardKeys) > 500 {
		return nil, invalid("Import up to 500 cards at a time.")
	}
	if input.SetID != "" && input.CardKeys != nil && len(input.CardKeys) == 0 {
		return nil, invalid("Choose at least one card from the set.")
	}
	if input.SetID == "" {
		if len(input.CardKeys) > 0 {
			return nil, ErrInvalid
		}
		cards := make([]CatalogCard, 0, len(input.Cards))
		for _, content := range input.Cards {
			content.Normalize()
			if err := content.Validate(); err != nil {
				return nil, err
			}
			cards = append(cards, CatalogCard{CardContent: content})
		}
		return cards, nil
	}
	if input.Status != "" && input.Status != "active" && input.Status != "known" {
		return nil, ErrInvalid
	}
	sets, err := Catalog(nativeLanguage)
	if err != nil {
		return nil, err
	}
	keys := make(map[string]bool, len(input.CardKeys))
	for _, key := range input.CardKeys {
		keys[key] = true
	}
	for _, set := range sets {
		if set.ID != input.SetID {
			continue
		}
		cards := make([]CatalogCard, 0, len(set.Cards))
		for _, card := range set.Cards {
			if len(keys) > 0 && !keys[card.ID] {
				continue
			}
			card.FolderID = input.FolderID
			if input.Status != "" {
				card.Status = input.Status
			}
			if err := card.Validate(); err != nil {
				return nil, err
			}
			cards = append(cards, card)
		}
		if len(keys) > 0 && len(cards) != len(keys) {
			return nil, ErrInvalid
		}
		return cards, nil
	}
	return nil, ErrNotFound
}
