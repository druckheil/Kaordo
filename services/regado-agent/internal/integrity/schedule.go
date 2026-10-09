package integrity

// Starts due integrity operations from the desired state, one at a time and inside a quiet window
import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
)

// ErrNothingToCheck means no device supports the requested check.
var ErrNothingToCheck = errors.New("no device supports this check")

// ScheduledBy is the requester recorded on operations the scheduler starts.
const ScheduledBy = "schedule"

var intervals = map[string]time.Duration{"weekly": 7 * 24 * time.Hour, "monthly": 30 * 24 * time.Hour}

type Scheduler struct {
	Operations *operation.Manager
	States     *state.Store
	// Request builds the operation for a kind, or ErrNothingToCheck
	Request func(ctx context.Context, kind, requestedBy, reason string) (operation.Request, error)
	Now     func() time.Time
	// Window is the local hour range [from, to) in which scheduled work may start
	Window [2]int
}

// Run checks for due work every interval until ctx ends.
func (scheduler *Scheduler) Run(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		if err := scheduler.Tick(ctx); err != nil && ctx.Err() == nil {
			slog.Warn("integrity schedule failed", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Tick starts the first due check: scrub, then the long self-test, then the short one.
func (scheduler *Scheduler) Tick(ctx context.Context) error {
	now := scheduler.Now()
	if hour := now.Hour(); hour < scheduler.Window[0] || hour >= scheduler.Window[1] {
		return nil
	}
	document, err := scheduler.States.Current()
	if err != nil {
		return err
	}
	last, active, err := scheduler.history()
	if err != nil || active {
		return err
	}
	// A long self-test also covers everything the short one reads
	last[KindSMARTShort] = later(last[KindSMARTShort], last[KindSMARTLong])
	for _, check := range []struct{ kind, frequency string }{
		{KindScrub, document.Integrity.Scrub},
		{KindSMARTLong, document.Integrity.SmartLong},
		{KindSMARTShort, document.Integrity.SmartShort},
	} {
		interval, enabled := intervals[check.frequency]
		if !enabled || now.Sub(last[check.kind]) < interval {
			continue
		}
		request, err := scheduler.Request(ctx, check.kind, ScheduledBy, "Scheduled "+check.frequency+" check")
		if errors.Is(err, ErrNothingToCheck) {
			continue
		}
		if err != nil {
			return err
		}
		_, err = scheduler.Operations.Start(request)
		return err
	}
	return nil
}

// history finds when each check last ran; interrupted runs do not count, so they retry
func (scheduler *Scheduler) history() (map[string]time.Time, bool, error) {
	recent, err := scheduler.Operations.List(500)
	if err != nil {
		return nil, false, err
	}
	last := map[string]time.Time{}
	for _, item := range recent {
		if !strings.HasPrefix(item.Kind, "integrity.") {
			continue
		}
		if !item.State.Finished() {
			return nil, true, nil
		}
		if _, seen := last[item.Kind]; !seen && item.State != operation.Interrupted {
			last[item.Kind] = item.CreatedAt
		}
	}
	return last, false, nil
}

func later(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
