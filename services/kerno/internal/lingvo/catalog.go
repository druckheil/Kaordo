// Package lingvo serves the embedded German starter catalog for device-encrypted dictionaries.
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
