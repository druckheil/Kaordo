package operation

// Queues, runs and records operations; exclusive ones run one at a time in submission order
import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound       = errors.New("operation not found")
	ErrNotCancellable = errors.New("operation cannot be cancelled")
	ErrClosed         = errors.New("operation manager is closed")
	ErrInvalid        = errors.New("invalid operation request")
)

type Manager struct {
	store    *store
	now      func() time.Time
	ctx      context.Context
	shutdown context.CancelFunc
	workers  sync.WaitGroup

	// mu guards active jobs, the exclusive queue and every store write
	mu        sync.Mutex
	active    map[string]*Job
	queue     []*Job
	exclusive bool
	closed    bool
}

// Open loads the journal in directory. Operations that were queued or running when the
// previous process stopped are recorded as interrupted; their owners decide how to resume.
func Open(directory string, now func() time.Time) (*Manager, error) {
	store, err := openStore(directory)
	if err != nil {
		return nil, err
	}
	ctx, shutdown := context.WithCancel(context.Background())
	manager := &Manager{store: store, now: now, ctx: ctx, shutdown: shutdown, active: make(map[string]*Job)}
	if err := manager.recover(); err != nil {
		shutdown()
		_ = store.close()
		return nil, err
	}
	return manager, nil
}

func (manager *Manager) recover() error {
	ids, err := manager.store.ids()
	if err != nil {
		return err
	}
	now := manager.now()
	for _, id := range ids {
		record, err := manager.store.load(id)
		if err != nil || record.State.Finished() {
			continue
		}
		record.Operation = finished(record.Operation, Interrupted, "The agent stopped before this operation finished.", now)
		if err := manager.store.save(record); err != nil {
			return err
		}
	}
	return manager.store.prune(now, func(string) bool { return false })
}

// Start records the request and queues it; the returned snapshot is already persisted.
func (manager *Manager) Start(request Request) (Operation, error) {
	if request.Kind == "" || request.Run == nil || len(request.Stages) == 0 || request.RequestedBy == "" {
		return Operation{}, ErrInvalid
	}
	id, err := uuid.NewV7()
	if err != nil {
		return Operation{}, err
	}
	stages := make([]Stage, len(request.Stages))
	for index, name := range request.Stages {
		stages[index] = Stage{Name: name, State: Queued}
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.closed {
		return Operation{}, ErrClosed
	}
	ctx, cancel := context.WithCancel(manager.ctx)
	job := &Job{manager: manager, request: request, ctx: ctx, cancel: cancel, current: -1, record: Record{
		Operation: Operation{
			ID: id.String(), Kind: request.Kind, Target: request.Target, Reason: request.Reason,
			RequestedBy: request.RequestedBy, State: Queued, Cancellable: request.Cancellable,
			Stages: stages, CreatedAt: manager.now(),
		},
		Log: []LogEntry{},
	}}
	if err := manager.store.save(job.record); err != nil {
		cancel()
		return Operation{}, err
	}
	manager.active[job.record.ID] = job
	if request.Exclusive {
		manager.queue = append(manager.queue, job)
		manager.dispatchLocked()
	} else {
		manager.launchLocked(job)
	}
	return job.snapshotLocked().Operation, nil
}

func (manager *Manager) dispatchLocked() {
	if manager.exclusive || len(manager.queue) == 0 || manager.closed {
		return
	}
	job := manager.queue[0]
	manager.queue = manager.queue[1:]
	manager.exclusive = true
	manager.launchLocked(job)
}

func (manager *Manager) launchLocked(job *Job) {
	manager.workers.Go(job.run)
}

// finish is called by a job when its work returns
func (manager *Manager) finish(job *Job, err error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	state, message := Succeeded, ""
	switch {
	case err == nil:
	case job.cancelRequested && errors.Is(job.ctx.Err(), context.Canceled):
		state, message = Cancelled, "Cancelled by an administrator."
	case manager.ctx.Err() != nil:
		state, message = Interrupted, "The agent stopped before this operation finished."
	default:
		state, message = Failed, boundedMessage(err.Error())
	}
	job.record.Operation = finished(job.record.Operation, state, message, manager.now())
	job.cancel()
	manager.saveLocked(job)
	delete(manager.active, job.record.ID)
	if job.request.Exclusive {
		manager.exclusive = false
		manager.dispatchLocked()
	}
	_ = manager.store.prune(manager.now(), func(id string) bool { return manager.active[id] != nil })
}

func (manager *Manager) saveLocked(job *Job) {
	job.savedAt = manager.now()
	// A failed write keeps the in-memory record; the next transition retries
	_ = manager.store.save(job.snapshotLocked())
}

// Cancel stops a cancellable operation. A queued one is cancelled without starting.
func (manager *Manager) Cancel(id string) (Operation, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	job := manager.active[id]
	if job == nil {
		return Operation{}, ErrNotFound
	}
	if !job.record.Cancellable {
		return Operation{}, ErrNotCancellable
	}
	job.cancelRequested = true
	job.cancel()
	if job.record.State == Queued {
		for index, queued := range manager.queue {
			if queued == job {
				manager.queue = append(manager.queue[:index], manager.queue[index+1:]...)
				break
			}
		}
		job.record.Operation = finished(job.record.Operation, Cancelled, "Cancelled before it started.", manager.now())
		manager.saveLocked(job)
		delete(manager.active, id)
	}
	return job.snapshotLocked().Operation, nil
}

// Get returns an operation with its log.
func (manager *Manager) Get(id string) (Record, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if job := manager.active[id]; job != nil {
		return job.snapshotLocked(), nil
	}
	return manager.store.load(id)
}

// List returns up to limit operations, newest first, without logs.
func (manager *Manager) List(limit int) ([]Operation, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	ids, err := manager.store.ids()
	if err != nil {
		return nil, err
	}
	operations := make([]Operation, 0, min(limit, len(ids)))
	for _, id := range ids {
		if len(operations) == limit {
			break
		}
		if job := manager.active[id]; job != nil {
			operations = append(operations, job.snapshotLocked().Operation)
			continue
		}
		if record, err := manager.store.load(id); err == nil {
			operations = append(operations, record.Operation)
		}
	}
	return operations, nil
}

// Close interrupts running work, records queued operations as interrupted and waits for jobs.
func (manager *Manager) Close() {
	manager.mu.Lock()
	if manager.closed {
		manager.mu.Unlock()
		return
	}
	manager.closed = true
	for _, job := range manager.queue {
		job.record.Operation = finished(job.record.Operation, Interrupted, "The agent stopped before this operation started.", manager.now())
		manager.saveLocked(job)
		delete(manager.active, job.record.ID)
	}
	manager.queue = nil
	manager.shutdown()
	manager.mu.Unlock()
	manager.workers.Wait()
	_ = manager.store.close()
}

func finished(operation Operation, state State, message string, now time.Time) Operation {
	operation.State, operation.Error, operation.FinishedAt = state, message, &now
	if state == Succeeded {
		operation.Error = ""
	}
	stages := make([]Stage, len(operation.Stages))
	copy(stages, operation.Stages)
	for index := range stages {
		switch stages[index].State {
		case Running:
			stages[index].State, stages[index].FinishedAt = state, &now
		case Queued:
			if state == Succeeded {
				stages[index].State = Skipped
			}
		}
	}
	operation.Stages = stages
	return operation
}

func boundedMessage(message string) string {
	const limit = 1000
	if len(message) > limit {
		return message[:limit]
	}
	return message
}
