package operation

// Lets running work report stages, measured progress and log lines without touching storage directly
import (
	"context"
	"fmt"
	"time"
)

const (
	logLimit     = 200
	saveInterval = time.Second
)

// Job is the handle a running operation uses to report its state.
type Job struct {
	manager         *Manager
	request         Request
	ctx             context.Context
	cancel          context.CancelFunc
	cancelRequested bool
	record          Record
	current         int
	savedAt         time.Time
}

func (job *Job) run() {
	job.manager.mu.Lock()
	if job.ctx.Err() != nil {
		job.manager.mu.Unlock()
		job.manager.finish(job, job.ctx.Err())
		return
	}
	now := job.manager.now()
	job.record.State, job.record.StartedAt = Running, &now
	job.manager.saveLocked(job)
	job.manager.mu.Unlock()

	err := job.request.Run(job.ctx, job)
	if err == nil && job.ctx.Err() != nil {
		err = job.ctx.Err()
	}
	job.manager.finish(job, err)
}

// Stage starts the stage at index and completes the one before it.
func (job *Job) Stage(index int) {
	job.manager.mu.Lock()
	defer job.manager.mu.Unlock()
	if index < 0 || index >= len(job.record.Stages) || index == job.current {
		return
	}
	now := job.manager.now()
	if job.current >= 0 && job.record.Stages[job.current].State == Running {
		job.record.Stages[job.current].State = Succeeded
		job.record.Stages[job.current].FinishedAt = &now
	}
	for skipped := job.current + 1; skipped < index; skipped++ {
		job.record.Stages[skipped].State = Skipped
	}
	job.current = index
	job.record.Stages[index].State = Running
	job.record.Stages[index].StartedAt = &now
	job.manager.saveLocked(job)
}

// Progress records measured progress of the current stage; writes are throttled.
func (job *Job) Progress(done, total int64, unit string) {
	job.manager.mu.Lock()
	defer job.manager.mu.Unlock()
	if job.current < 0 {
		return
	}
	if total > 0 {
		done = min(done, total)
	}
	job.record.Stages[job.current].Progress = &Progress{Done: done, Total: total, Unit: unit}
	if job.manager.now().Sub(job.savedAt) >= saveInterval {
		job.manager.saveLocked(job)
	}
}

// Detail sets a short human-readable status for the current stage.
func (job *Job) Detail(text string) {
	job.manager.mu.Lock()
	defer job.manager.mu.Unlock()
	if job.current < 0 {
		return
	}
	job.record.Stages[job.current].Detail = boundedMessage(text)
	job.manager.saveLocked(job)
}

// Logf appends a line to the operation's bounded log.
func (job *Job) Logf(format string, args ...any) {
	job.manager.mu.Lock()
	defer job.manager.mu.Unlock()
	job.record.Log = append(job.record.Log, LogEntry{At: job.manager.now(), Message: boundedMessage(fmt.Sprintf(format, args...))})
	if len(job.record.Log) > logLimit {
		job.record.Log = job.record.Log[len(job.record.Log)-logLimit:]
	}
	if job.manager.now().Sub(job.savedAt) >= saveInterval {
		job.manager.saveLocked(job)
	}
}

func (job *Job) snapshotLocked() Record {
	record := job.record
	record.Stages = append([]Stage(nil), job.record.Stages...)
	record.Log = append(make([]LogEntry, 0, len(job.record.Log)), job.record.Log...)
	return record
}
