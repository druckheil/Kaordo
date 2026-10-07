package lingvo

// Adapts the official FSRS-6 scheduler to the shared browser scheduling contract
import (
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v4"
)

// LearningSteps is the zero-based step index used by ts-fsrs
type Schedule struct {
	Due           time.Time  `json:"due"`
	Stability     float64    `json:"stability"`
	Difficulty    float64    `json:"difficulty"`
	ScheduledDays uint64     `json:"scheduledDays"`
	Reps          uint64     `json:"reps"`
	Lapses        uint64     `json:"lapses"`
	State         int        `json:"state"`
	LastReview    *time.Time `json:"lastReview"`
	LearningSteps int        `json:"learningSteps"`
}

func NewSchedule(now time.Time) Schedule { return fromFSRS(fsrs.NewCard(now)) }

func NextSchedule(card Schedule, rating int, now time.Time) (Schedule, error) {
	// Both clients use the published FSRS-6 defaults with deterministic intervals
	scheduler := fsrs.NewFSRS(fsrs.DefaultParam())
	result, err := scheduler.Next(card.core(), now, fsrs.Rating(rating))
	if err != nil {
		return Schedule{}, err
	}
	return fromFSRS(result.Card), nil
}

func (s Schedule) core() fsrs.Card {
	card := fsrs.Card{Due: s.Due, Stability: s.Stability, Difficulty: s.Difficulty,
		ScheduledDays: s.ScheduledDays, Reps: s.Reps, Lapses: s.Lapses, State: fsrs.State(s.State)}
	if s.LastReview != nil {
		card.LastReview = *s.LastReview
	}
	if s.State == int(fsrs.Learning) {
		card.RemainingSteps = max(0, len(fsrs.DefaultLearningSteps())-s.LearningSteps)
	}
	if s.State == int(fsrs.Relearning) {
		card.RemainingSteps = max(0, len(fsrs.DefaultRelearningSteps())-s.LearningSteps)
	}
	return card
}

func fromFSRS(card fsrs.Card) Schedule {
	s := Schedule{Due: card.Due, Stability: card.Stability, Difficulty: card.Difficulty,
		ScheduledDays: card.ScheduledDays, Reps: card.Reps, Lapses: card.Lapses, State: int(card.State)}
	if !card.LastReview.IsZero() {
		s.LastReview = &card.LastReview
	}
	if card.State == fsrs.Learning {
		s.LearningSteps = max(0, len(fsrs.DefaultLearningSteps())-card.RemainingSteps)
	}
	if card.State == fsrs.Relearning {
		s.LearningSteps = max(0, len(fsrs.DefaultRelearningSteps())-card.RemainingSteps)
	}
	return s
}
