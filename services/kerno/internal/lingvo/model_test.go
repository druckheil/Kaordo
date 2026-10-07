package lingvo

// Covers normalized German content, private language pairs and bounded import selection
import (
	"errors"
	"strings"
	"testing"
)

func validWord() CardContent {
	return CardContent{Kind: "word", Term: "Haus", Translation: "house", PartOfSpeech: "noun", Article: "das", Status: "active"}
}

func TestDictionaryAndReviewValidation(t *testing.T) {
	for _, native := range []string{"en", "ru"} {
		if err := (NewDictionary{"de", native, "Europe/Berlin"}).Validate(); err != nil {
			t.Fatal(err)
		}
	}
	for _, input := range []NewDictionary{{"fr", "en", "UTC"}, {"de", "de", "UTC"}, {"de", "en", "Local"}, {"de", "en", "Mars/Olympus"}, {"de", "en", ""}} {
		if err := input.Validate(); !errors.Is(err, ErrInvalid) {
			t.Fatalf("accepted pair %+v: %v", input, err)
		}
	}
	for _, goal := range []int{5, 200} {
		if err := (Settings{goal, "UTC"}).Validate(); err != nil {
			t.Fatal(err)
		}
	}
	for _, goal := range []int{4, 201} {
		if err := (Settings{goal, "UTC"}).Validate(); !errors.Is(err, ErrInvalid) {
			t.Fatal("accepted invalid daily goal")
		}
	}
	const id = "01999abc-1234-7000-8000-000000000001"
	for _, direction := range []string{"recognition", "recall", "listening", "phrase"} {
		if err := (Review{id, 1, 3, direction}).Validate(); err != nil {
			t.Fatal(err)
		}
	}
	for _, review := range []Review{{"bad", 1, 3, "recall"}, {id, 0, 3, "recall"}, {id, 1, 0, "recall"}, {id, 1, 5, "recall"}, {id, 1, 3, "unknown"}} {
		if err := review.Validate(); !errors.Is(err, ErrInvalid) {
			t.Fatalf("accepted review %+v", review)
		}
	}
	for _, invalid := range []string{"", "00000000-0000-0000-0000-000000000000", strings.ReplaceAll(id, "-", "")} {
		if ValidID(invalid) {
			t.Fatalf("accepted ID %q", invalid)
		}
	}
}

func TestCardNormalizationAndValidation(t *testing.T) {
	card := validWord()
	card.Term, card.Translation, card.Status = "  Ha\u0308user  ", "  houses\n ", ""
	upper := "01999ABC-1234-7000-8000-000000000001"
	card.FolderID = &upper
	card.Normalize()
	if card.Term != "Häuser" || card.Translation != "houses" || card.Status != "active" || *card.FolderID != strings.ToLower(upper) {
		t.Fatalf("normalization = %+v", card)
	}
	if err := card.Validate(); err != nil {
		t.Fatal(err)
	}
	changes := []func(*CardContent){
		func(v *CardContent) { v.Kind = "other" }, func(v *CardContent) { v.Status = "other" },
		func(v *CardContent) { v.PartOfSpeech = "other-invalid" }, func(v *CardContent) { v.Article = "den" },
		func(v *CardContent) { v.Kind = "phrase" }, func(v *CardContent) { v.PartOfSpeech = "verb" },
		func(v *CardContent) { v.Term = "" }, func(v *CardContent) { v.Term = strings.Repeat("ü", 301) },
		func(v *CardContent) { v.Notes = "bad\x00text" }, func(v *CardContent) { v.Notes = string([]byte{0xff}) },
		func(v *CardContent) { bad := "not-an-id"; v.FolderID = &bad },
	}
	for i, change := range changes {
		value := validWord()
		change(&value)
		if err := value.Validate(); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid case %d = %v", i, err)
		}
	}
	if !ValidText("a\nb\tc", 5, 5) || ValidText("\r", 1, 1) || ValidText("\u0085", 1, 1) {
		t.Fatal("control-character policy changed")
	}
}

func TestCatalogAndImportSelection(t *testing.T) {
	for _, native := range []string{"en", "ru"} {
		sets, err := Catalog(native)
		if err != nil || len(sets) == 0 {
			t.Fatalf("catalog %s: %v", native, err)
		}
		seen := map[string]bool{}
		for _, set := range sets {
			for _, card := range set.Cards {
				if seen[card.ID] || card.Validate() != nil {
					t.Fatalf("invalid catalog identity %s", card.ID)
				}
				seen[card.ID] = true
			}
		}
	}
	if _, err := Catalog("fr"); !errors.Is(err, ErrInvalid) {
		t.Fatal("accepted unsupported native language")
	}
	sets, _ := Catalog("en")
	set := sets[0]
	key := set.Cards[0].ID
	selected, err := ImportCards(Import{SetID: set.ID, CardKeys: []string{key, key}, Status: "known"}, "en")
	if err != nil || len(selected) != 1 || selected[0].Status != "known" {
		t.Fatalf("selection = %+v, %v", selected, err)
	}
	all, err := ImportCards(Import{SetID: set.ID}, "en")
	if err != nil || len(all) != len(set.Cards) {
		t.Fatal("nil selection did not import the set")
	}
	if set.Cards[0].Status != "active" {
		t.Fatal("selection mutated catalog content")
	}
	for _, input := range []Import{{}, {SetID: set.ID, Cards: []CardContent{validWord()}}, {SetID: set.ID, CardKeys: []string{}}, {SetID: set.ID, CardKeys: []string{"missing"}}, {SetID: set.ID, Status: "suspended"}, {Cards: []CardContent{validWord()}, CardKeys: []string{key}}, {Cards: make([]CardContent, 501)}} {
		if _, err := ImportCards(input, "en"); !errors.Is(err, ErrInvalid) {
			t.Fatalf("accepted import %+v: %v", input, err)
		}
	}
	if _, err := ImportCards(Import{SetID: "missing"}, "en"); !errors.Is(err, ErrNotFound) {
		t.Fatal("missing set did not return not found")
	}
	word := validWord()
	word.Term = "  Ha\u0308user  "
	word.Status = ""
	custom, err := ImportCards(Import{Cards: []CardContent{word}}, "en")
	if err != nil || custom[0].Term != "Häuser" || custom[0].Status != "active" || word.Term == custom[0].Term {
		t.Fatalf("custom normalization = %+v, %v", custom, err)
	}
}
