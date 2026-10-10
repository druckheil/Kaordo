// Package operation runs host changes as persistent, observable and optionally cancellable jobs.
package operation

// Defines the operation record that Regado renders and the agent persists
import (
	"context"
	"time"
)

type State string

const (
	Queued      State = "queued"
	Running     State = "running"
	Succeeded   State = "succeeded"
	Failed      State = "failed"
	Cancelled   State = "cancelled"
	Interrupted State = "interrupted"
	// Skipped marks stages a successful operation did not need
	Skipped State = "skipped"
)

// Finished reports whether an operation in this state has ended.
func (state State) Finished() bool {
	return state != Queued && state != Running
}

// Progress is measured by the tool doing the work. A zero total means the size is unknown.
type Progress struct {
	Done  int64  `json:"done"`
	Total int64  `json:"total"`
	Unit  string `json:"unit"`
}

type Stage struct {
	Name       string     `json:"name"`
	State      State      `json:"state"`
	Progress   *Progress  `json:"progress,omitempty"`
	Detail     string     `json:"detail,omitempty"`
	StartedAt  *time.Time `json:"startedAt,omitempty"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
}

type Operation struct {
	ID          string     `json:"id"`
	Kind        string     `json:"kind"`
	Target      string     `json:"target,omitempty"`
	Reason      string     `json:"reason,omitempty"`
	RequestedBy string     `json:"requestedBy"`
	State       State      `json:"state"`
	Cancellable bool       `json:"cancellable"`
	Stages      []Stage    `json:"stages"`
	Error       string     `json:"error,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	FinishedAt  *time.Time `json:"finishedAt,omitempty"`
}

type LogEntry struct {
	At      time.Time `json:"at"`
	Message string    `json:"message"`
}

// Record is the persisted form: the operation and its bounded log.
type Record struct {
	Operation
	Log []LogEntry `json:"log"`
}

// Request describes a job before it is queued.
type Request struct {
	Kind        string
	Target      string
	Reason      string
	RequestedBy string
	// Exclusive operations change the host and run one at a time in submission order.
	Exclusive bool
	// Cancellable is set only when the underlying tool can stop without damage.
	Cancellable bool
	Stages      []string
	Run         func(ctx context.Context, job *Job) error
}
