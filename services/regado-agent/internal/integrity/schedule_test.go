package integrity

// Verifies that scheduled checks start inside the window, one at a time, in priority order
import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
)

type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) Set(now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = now
}

type scheduleFixture struct {
	scheduler   *Scheduler
	operations  *operation.Manager
	clock       *clock
	release     chan struct{}
	unsupported map[string]bool
}

func newScheduleFixture(t *testing.T) *scheduleFixture {
	t.Helper()
	fixture := &scheduleFixture{
		clock:       &clock{now: time.Date(2026, 10, 10, 3, 0, 0, 0, time.Local)},
		release:     make(chan struct{}),
		unsupported: map[string]bool{},
	}
	operations, err := operation.Open(t.TempDir(), fixture.clock.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(operations.Close)
	t.Cleanup(func() { close(fixture.release) })
	states, err := state.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(states.Close)
	if _, _, err := states.Put(state.Default([]string{"wwn-0x50014ee0aaaa0001", "wwn-0x50014ee0aaaa0002"})); err != nil {
		t.Fatal(err)
	}
	fixture.operations = operations
	fixture.scheduler = &Scheduler{
		Operations: operations, States: states, Now: fixture.clock.Now, Window: [2]int{2, 6},
		Request: func(_ context.Context, kind, requestedBy, reason string) (operation.Request, error) {
			if fixture.unsupported[kind] {
				return operation.Request{}, ErrNothingToCheck
			}
			return operation.Request{
				Kind: kind, RequestedBy: requestedBy, Reason: reason, Stages: []string{"Check"},
				Run: func(ctx context.Context, _ *operation.Job) error {
					select {
					case <-fixture.release:
					case <-ctx.Done():
					}
					return nil
				},
			}, nil
		},
	}
	return fixture
}

// tick runs one scheduling pass and returns the kind it started, after letting that run finish
func (fixture *scheduleFixture) tick(t *testing.T) string {
	t.Helper()
	if err := fixture.scheduler.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	recent, err := fixture.operations.List(1)
	if err != nil || len(recent) == 0 || recent[0].State.Finished() {
		return ""
	}
	before := len(fixture.list(t))
	if err := fixture.scheduler.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fixture.list(t)) != before {
		t.Fatal("a second check started while one was running")
	}
	fixture.release <- struct{}{}
	deadline := time.Now().Add(5 * time.Second)
	for {
		if record, _ := fixture.operations.Get(recent[0].ID); record.State.Finished() {
			return recent[0].Kind
		}
		if time.Now().After(deadline) {
			t.Fatal("scheduled check did not finish")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func (fixture *scheduleFixture) list(t *testing.T) []operation.Operation {
	t.Helper()
	items, err := fixture.operations.List(500)
	if err != nil {
		t.Fatal(err)
	}
	return items
}

func TestSchedulerRunsDueChecksInOrderInsideTheWindow(t *testing.T) {
	fixture := newScheduleFixture(t)
	fixture.clock.Set(time.Date(2026, 10, 10, 12, 0, 0, 0, time.Local))
	if kind := fixture.tick(t); kind != "" {
		t.Fatalf("started %s outside the window", kind)
	}

	fixture.clock.Set(time.Date(2026, 10, 10, 3, 0, 0, 0, time.Local))
	for _, want := range []string{KindScrub, KindSMARTLong, ""} {
		if got := fixture.tick(t); got != want {
			t.Fatalf("started %q, want %q", got, want)
		}
	}
	if items := fixture.list(t); items[0].RequestedBy != ScheduledBy || items[0].Reason != "Scheduled monthly check" {
		t.Fatalf("scheduled operation = %+v", items[0])
	}

	// A week later only the short test is due: the long test was a month's, the scrub too
	fixture.clock.Set(time.Date(2026, 10, 17, 3, 30, 0, 0, time.Local))
	for _, want := range []string{KindSMARTShort, ""} {
		if got := fixture.tick(t); got != want {
			t.Fatalf("a week later started %q, want %q", got, want)
		}
	}
	fixture.clock.Set(time.Date(2026, 11, 10, 3, 30, 0, 0, time.Local))
	if got := fixture.tick(t); got != KindScrub {
		t.Fatalf("a month later started %q, want the scrub", got)
	}
}

func TestSchedulerSkipsChecksNoDeviceSupports(t *testing.T) {
	fixture := newScheduleFixture(t)
	fixture.unsupported[KindSMARTLong] = true
	fixture.unsupported[KindSMARTShort] = true
	for _, want := range []string{KindScrub, ""} {
		if got := fixture.tick(t); got != want {
			t.Fatalf("started %q, want %q", got, want)
		}
	}
}
