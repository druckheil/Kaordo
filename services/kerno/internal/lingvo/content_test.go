package lingvo

// Covers German card validation and the embedded starter catalog
import (
	"errors"
	"strings"
	"testing"
)

func validWord() CardContent {
	return CardContent{Kind: "word", Term: "Haus", Translation: "house", PartOfSpeech: "noun", Article: "das", Status: "active"}
}

func TestCardValidation(t *testing.T) {
	if err := validWord().Validate(); err != nil {
		t.Fatal(err)
	}
	changes := []func(*CardContent){
		func(v *CardContent) { v.Kind = "other" }, func(v *CardContent) { v.Status = "other" },
		func(v *CardContent) { v.PartOfSpeech = "other-invalid" }, func(v *CardContent) { v.Article = "den" },
		func(v *CardContent) { v.Kind = "phrase" }, func(v *CardContent) { v.PartOfSpeech = "verb" },
		func(v *CardContent) { v.Term = "" }, func(v *CardContent) { v.Term = strings.Repeat("ü", 301) },
		func(v *CardContent) { v.Notes = "bad\x00text" }, func(v *CardContent) { v.Notes = string([]byte{0xff}) },
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

func TestCatalog(t *testing.T) {
	for _, native := range []string{"en", "ru"} {
		sets, err := Catalog(native)
		if err != nil || len(sets) == 0 {
			t.Fatalf("catalog %s: %v", native, err)
		}
		seen := map[string]bool{}
		for _, set := range sets {
			for _, card := range set.Cards {
				if seen[card.ID] || card.Validate() != nil || card.Status != "active" {
					t.Fatalf("invalid catalog identity %s", card.ID)
				}
				seen[card.ID] = true
			}
		}
	}
	if _, err := Catalog("fr"); !errors.Is(err, ErrInvalid) {
		t.Fatal("accepted unsupported native language")
	}
}
