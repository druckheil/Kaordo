package lingvo

// Verifies the server adapter against the official browser scheduler across every card state
import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"strconv"
	"testing"
	"time"
)

func TestSchedulerBrowserConformance(t *testing.T) {
	data, err := os.ReadFile("testdata/fsrs-schedules.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name     string              `json:"name"`
			Now      time.Time           `json:"now"`
			Card     Schedule            `json:"card"`
			Expected map[string]Schedule `json:"expected"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) != 8 {
		t.Fatal("conformance fixture lost a card-state scenario")
	}
	for _, scenario := range fixture.Cases {
		for rating := 1; rating <= 4; rating++ {
			t.Run(scenario.Name+"/"+strconv.Itoa(rating), func(t *testing.T) {
				t.Parallel()
				got, err := NextSchedule(scenario.Card, rating, scenario.Now)
				if err != nil {
					t.Fatal(err)
				}
				want := scenario.Expected[strconv.Itoa(rating)]
				// ts-fsrs rounds model values to eight decimals; Go retains float64 precision
				if math.Abs(got.Stability-want.Stability) > 1e-7*math.Max(1, want.Stability) || math.Abs(got.Difficulty-want.Difficulty) > 1e-7*math.Max(1, want.Difficulty) {
					t.Fatalf("FSRS model mismatch: got %+v, want %+v", got, want)
				}
				got.Stability, got.Difficulty = want.Stability, want.Difficulty
				if !got.Due.Equal(want.Due) || got.LastReview == nil || !got.LastReview.Equal(*want.LastReview) {
					t.Fatalf("review instant mismatch: got %+v, want %+v", got, want)
				}
				got.Due, got.LastReview = want.Due, want.LastReview
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("schedule mismatch: got %+v, want %+v", got, want)
				}
			})
		}
	}
}

func BenchmarkNextSchedule(b *testing.B) {
	now := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)
	card := NewSchedule(now)
	b.ReportAllocs()
	for b.Loop() {
		if _, err := NextSchedule(card, 3, now); err != nil {
			b.Fatal(err)
		}
	}
}

func TestSchedulerNewCardAndInvalidRating(t *testing.T) {
	now := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)
	card := NewSchedule(now)
	if !card.Due.Equal(now) || card.Reps != 0 || card.LastReview != nil || card.State != 0 {
		t.Fatalf("new card = %+v", card)
	}
	for _, rating := range []int{-1, 0, 5, 100} {
		if _, err := NextSchedule(card, rating, now); err == nil {
			t.Fatalf("accepted rating %d", rating)
		}
	}
	for rating := 1; rating <= 4; rating++ {
		scheduled, err := NextSchedule(card, rating, now)
		if err != nil || scheduled.Reps != 1 || !scheduled.Due.After(now) {
			t.Fatalf("rating %d = %+v, %v", rating, scheduled, err)
		}
	}
}
