package postgres

// Exercises private dictionary isolation, card identity and transactional learning with PostgreSQL
import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/lingvo"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type lingvoDatabase struct {
	ctx          context.Context
	pool         *pgxpool.Pool
	store        *Lingvo
	owner, other account.User
	dictionary   lingvo.Dictionary
}

func newLingvoDatabase(t *testing.T) lingvoDatabase {
	t.Helper()
	dsn := os.Getenv("KAORDO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set KAORDO_TEST_DATABASE_URL to an isolated migrated test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	users := NewUsers(pool)
	createUser := func() account.User {
		t.Helper()
		id := uuid.NewString()
		user, err := users.Upsert(ctx, "lingvo-test-"+id, "learner-"+id[:8], "Learner")
		if err != nil {
			t.Fatal(err)
		}
		return user
	}
	fixture := lingvoDatabase{ctx: ctx, pool: pool, store: NewLingvo(pool), owner: createUser(), other: createUser()}
	fixture.dictionary, err = fixture.store.CreateDictionary(ctx, fixture.owner.ID, lingvo.NewDictionary{
		LearningLanguage: "de", NativeLanguage: "en", TimeZone: "Europe/Berlin",
	})
	if err != nil {
		t.Fatal(err)
	}
	return fixture
}

func lingvoWord() lingvo.CardContent {
	return lingvo.CardContent{Kind: "word", Term: "Buch", Translation: "book", PartOfSpeech: "noun", Article: "das", Status: "active"}
}

func TestLingvoDictionaryAndCardFlow(t *testing.T) {
	f := newLingvoDatabase(t)
	ctx, store, actor, id := f.ctx, f.store, f.owner.ID, f.dictionary.ID
	settings, err := store.UpdateSettings(ctx, actor, id, lingvo.Settings{DailyGoal: 35, TimeZone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	again, err := store.CreateDictionary(ctx, actor, lingvo.NewDictionary{LearningLanguage: "de", NativeLanguage: "en", TimeZone: "Europe/Berlin"})
	if err != nil || !reflect.DeepEqual(again, settings) {
		t.Fatalf("dictionary retry reset preferences: %+v, %v", again, err)
	}
	native, err := store.CreateDictionary(ctx, actor, lingvo.NewDictionary{LearningLanguage: "de", NativeLanguage: "ru", TimeZone: "UTC"})
	if err != nil || native.ID == id {
		t.Fatalf("native languages shared a dictionary: %+v, %v", native, err)
	}
	if _, err := store.Overview(ctx, f.other.ID, id); !errors.Is(err, lingvo.ErrNotFound) {
		t.Fatalf("overview leaked: %v", err)
	}
	if _, err := store.Cards(ctx, f.other.ID, id, lingvo.CardFilter{Limit: 50}); !errors.Is(err, lingvo.ErrNotFound) {
		t.Fatalf("cards leaked: %v", err)
	}
	if _, err := store.Study(ctx, f.other.ID, id, lingvo.CardFilter{Kind: "word"}); !errors.Is(err, lingvo.ErrNotFound) {
		t.Fatalf("study leaked: %v", err)
	}
	input := lingvo.NewCard{ID: uuid.NewString(), CardContent: lingvoWord()}
	if _, err := store.CreateCard(ctx, f.other.ID, id, input); !errors.Is(err, lingvo.ErrNotFound) {
		t.Fatalf("foreign card creation: %v", err)
	}
	card, err := store.CreateCard(ctx, actor, id, input)
	if err != nil {
		t.Fatal(err)
	}
	retried, err := store.CreateCard(ctx, actor, id, input)
	if err != nil || !reflect.DeepEqual(retried, card) {
		t.Fatalf("card retry = %+v, %v", retried, err)
	}
	changed := input
	changed.Translation = "a different meaning"
	if _, err := store.CreateCard(ctx, actor, id, changed); !errors.Is(err, lingvo.ErrConflict) {
		t.Fatalf("changed retry = %v", err)
	}
	updated, err := store.UpdateCard(ctx, actor, id, card.ID, lingvo.CardUpdate{Revision: card.Revision, CardContent: changed.CardContent})
	if err != nil || updated.Revision != card.Revision+1 || !reflect.DeepEqual(updated.Schedule, card.Schedule) {
		t.Fatalf("content edit reset learning: %+v, %v", updated, err)
	}
	if _, err := store.UpdateCard(ctx, actor, id, card.ID, lingvo.CardUpdate{Revision: card.Revision, CardContent: input.CardContent}); !errors.Is(err, lingvo.ErrConflict) {
		t.Fatalf("stale edit = %v", err)
	}
	for _, query := range []string{"BUCH", "a DIFFERENT meaning"} {
		page, err := store.Cards(ctx, actor, id, lingvo.CardFilter{Search: query, Limit: 50})
		if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != card.ID {
			t.Fatalf("search %q = %+v, %v", query, page, err)
		}
	}
	if err := store.DeleteCard(ctx, actor, id, card.ID, card.Revision); !errors.Is(err, lingvo.ErrConflict) {
		t.Fatalf("stale delete = %v", err)
	}
	if err := store.DeleteCard(ctx, actor, id, card.ID, updated.Revision); err != nil {
		t.Fatal(err)
	}
}

func TestLingvoCSVImportIdentity(t *testing.T) {
	f := newLingvoDatabase(t)
	first, second := lingvoWord(), lingvoWord()
	first.Term, first.Translation = "Zeile\nzwei", "line"
	second.Term, second.Translation = "Zeile", "zwei\nline"
	result, err := f.store.Import(f.ctx, f.owner.ID, f.dictionary.ID, lingvo.Import{Cards: []lingvo.CardContent{first, second}})
	if err != nil || result.Added != 2 || result.Skipped != 0 {
		t.Fatalf("distinct multiline cards collided: %+v, %v", result, err)
	}
	result, err = f.store.Import(f.ctx, f.owner.ID, f.dictionary.ID, lingvo.Import{Cards: []lingvo.CardContent{first, second}})
	if err != nil || result.Added != 0 || result.Skipped != 2 {
		t.Fatalf("import retry duplicated cards: %+v, %v", result, err)
	}
	if _, err := f.store.Import(f.ctx, f.other.ID, f.dictionary.ID, lingvo.Import{Cards: []lingvo.CardContent{first}}); !errors.Is(err, lingvo.ErrNotFound) {
		t.Fatalf("foreign import = %v", err)
	}
	invalid := second
	invalid.Article = "invalid"
	if _, err := f.store.Import(f.ctx, f.owner.ID, f.dictionary.ID, lingvo.Import{Cards: []lingvo.CardContent{lingvoWord(), invalid}}); !errors.Is(err, lingvo.ErrInvalid) {
		t.Fatalf("invalid batch = %v", err)
	}
	page, err := f.store.Cards(f.ctx, f.owner.ID, f.dictionary.ID, lingvo.CardFilter{Limit: 50})
	if err != nil || page.Total != 2 {
		t.Fatalf("invalid batch partially committed: %+v, %v", page, err)
	}
}

func TestLingvoExistingCSVIdentityMigration(t *testing.T) {
	f := newLingvoDatabase(t)
	var contents []lingvo.CardContent
	for _, term := range []string{"Zeile\nzwei", "HÄUSER", "STRAẞE", "ΟΣ", "İ"} {
		content := lingvoWord()
		content.Term = term
		card, err := f.store.CreateCard(f.ctx, f.owner.ID, f.dictionary.ID, lingvo.NewCard{ID: uuid.NewString(), CardContent: content})
		if err != nil {
			t.Fatal(err)
		}
		contents = append(contents, card.CardContent)
		legacy := fmt.Sprintf("csv:%x", sha256.Sum256([]byte(card.Kind+"\n"+strings.ToLower(card.Term)+"\n"+strings.ToLower(card.Translation))))
		if _, err := f.pool.Exec(f.ctx, "UPDATE lingvo_cards SET source_key = $1 WHERE id = $2", legacy, card.ID); err != nil {
			t.Fatal(err)
		}
	}
	migration, err := os.ReadFile("../../../../deploy/postgres/017_lingvo_import_identity.sql")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := f.pool.Exec(f.ctx, string(migration)); err != nil {
			t.Fatal(err)
		}
	}
	result, err := f.store.Import(f.ctx, f.owner.ID, f.dictionary.ID, lingvo.Import{Cards: contents})
	if err != nil || result.Added != 0 || result.Skipped != len(contents) {
		t.Fatalf("existing import identity was lost: %+v, %v", result, err)
	}
}

func TestLingvoReviewConcurrencyAndUndo(t *testing.T) {
	f := newLingvoDatabase(t)
	card, err := f.store.CreateCard(f.ctx, f.owner.ID, f.dictionary.ID, lingvo.NewCard{ID: uuid.NewString(), CardContent: lingvoWord()})
	if err != nil {
		t.Fatal(err)
	}
	type outcome struct {
		input  lingvo.Review
		result lingvo.ReviewResult
		err    error
	}
	results := make(chan outcome, 12)
	for range 12 {
		go func() {
			input := lingvo.Review{ID: uuid.NewString(), Revision: card.Revision, Rating: 3, Direction: "recognition"}
			result, err := f.store.Review(f.ctx, f.owner.ID, f.dictionary.ID, card.ID, input)
			results <- outcome{input: input, result: result, err: err}
		}()
	}
	var accepted outcome
	count := 0
	for range 12 {
		result := <-results
		if result.err == nil {
			accepted = result
			count++
		} else if !errors.Is(result.err, lingvo.ErrConflict) {
			t.Fatal(result.err)
		}
	}
	if count != 1 {
		t.Fatalf("concurrent ratings committed %d times", count)
	}
	replayed, err := f.store.Review(f.ctx, f.owner.ID, f.dictionary.ID, card.ID, accepted.input)
	if err != nil || !reflect.DeepEqual(replayed, accepted.result) {
		t.Fatalf("review retry = %+v, %v", replayed, err)
	}
	if _, err := f.store.Undo(f.ctx, f.other.ID, f.dictionary.ID, accepted.input.ID); !errors.Is(err, lingvo.ErrNotFound) {
		t.Fatalf("foreign undo = %v", err)
	}
	restored, err := f.store.Undo(f.ctx, f.owner.ID, f.dictionary.ID, accepted.input.ID)
	if err != nil || !reflect.DeepEqual(restored.Schedule, card.Schedule) || restored.Revision != card.Revision+2 {
		t.Fatalf("undo did not restore the schedule: %+v, %v", restored, err)
	}
	again, err := f.store.Undo(f.ctx, f.owner.ID, f.dictionary.ID, accepted.input.ID)
	if err != nil || !reflect.DeepEqual(again, restored) {
		t.Fatalf("undo retry = %+v, %v", again, err)
	}
	if _, err := f.store.Review(f.ctx, f.owner.ID, f.dictionary.ID, card.ID, accepted.input); !errors.Is(err, lingvo.ErrConflict) {
		t.Fatalf("undone review replay = %v", err)
	}
}

func TestLingvoCapacityAndReadPaths(t *testing.T) {
	f := newLingvoDatabase(t)
	schedule, err := json.Marshal(lingvo.NewSchedule(time.Now().UTC()))
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.pool.Exec(f.ctx, `INSERT INTO lingvo_cards (dictionary_id, kind, term, translation, schedule, due_at)
		SELECT $1, 'word', 'Wort ' || value, 'word ' || value, $2::jsonb, clock_timestamp() - interval '1 day'
		FROM generate_series(1, 10000) value`, f.dictionary.ID, string(schedule))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.CreateCard(f.ctx, f.owner.ID, f.dictionary.ID, lingvo.NewCard{ID: uuid.NewString(), CardContent: lingvoWord()}); !errors.Is(err, lingvo.ErrLimit) {
		t.Fatalf("capacity overflow = %v", err)
	}
	page, err := f.store.Cards(f.ctx, f.owner.ID, f.dictionary.ID, lingvo.CardFilter{Kind: "word", Limit: 50})
	if err != nil || page.Total != 10000 || len(page.Items) != 50 {
		t.Fatalf("capacity rollback or pagination failed: total=%d items=%d, %v", page.Total, len(page.Items), err)
	}
	for _, kind := range []string{"dictionary", "study", "overview"} {
		t.Run(kind, func(t *testing.T) {
			timings := make([]time.Duration, 40)
			for index := range timings {
				started := time.Now()
				var err error
				switch kind {
				case "dictionary":
					_, err = f.store.Cards(f.ctx, f.owner.ID, f.dictionary.ID, lingvo.CardFilter{Kind: "word", Limit: 50})
				case "study":
					_, err = f.store.Study(f.ctx, f.owner.ID, f.dictionary.ID, lingvo.CardFilter{Kind: "word"})
				case "overview":
					_, err = f.store.Overview(f.ctx, f.owner.ID, f.dictionary.ID)
				}
				if err != nil {
					t.Fatal(err)
				}
				timings[index] = time.Since(started)
			}
			slices.Sort(timings)
			t.Logf("10,000 Lingvo cards / 40 reads: p50=%s p95=%s max=%s", timings[19], timings[37], timings[39])
		})
	}
}
