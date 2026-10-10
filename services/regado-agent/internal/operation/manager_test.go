package operation

// Verifies ordering, progress, cancellation, interruption and retention of the operation journal
import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

func openManager(t *testing.T, directory string) *Manager {
	t.Helper()
	manager, err := Open(directory, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(manager.Close)
	return manager
}

func waitFor(t *testing.T, manager *Manager, id string, states ...State) Record {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		record, err := manager.Get(id)
		if err != nil {
			t.Fatal(err)
		}
		for _, state := range states {
			if record.State == state {
				return record
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("operation %s stayed %s", id, record.State)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestExclusiveOperationsRunOneAtATimeInOrder(t *testing.T) {
	manager := openManager(t, t.TempDir())
	var running, peak atomic.Int32
	order := make(chan string, 3)
	ids := make([]string, 0, 3)
	for _, name := range []string{"first", "second", "third"} {
		operation, err := manager.Start(Request{
			Kind: "test.exclusive", Target: name, RequestedBy: "test", Exclusive: true, Stages: []string{"Work"},
			Run: func(context.Context, *Job) error {
				if current := running.Add(1); current > peak.Load() {
					peak.Store(current)
				}
				time.Sleep(20 * time.Millisecond)
				order <- name
				running.Add(-1)
				return nil
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, operation.ID)
	}
	for _, id := range ids {
		waitFor(t, manager, id, Succeeded)
	}
	close(order)
	got := []string{}
	for name := range order {
		got = append(got, name)
	}
	if peak.Load() != 1 || len(got) != 3 || got[0] != "first" || got[2] != "third" {
		t.Fatalf("exclusive runs overlapped (%d) or reordered: %v", peak.Load(), got)
	}
}

func TestProgressStagesAndLogArePersisted(t *testing.T) {
	directory := t.TempDir()
	manager := openManager(t, directory)
	release := make(chan struct{})
	operation, err := manager.Start(Request{
		Kind: "test.progress", RequestedBy: "test", Stages: []string{"Prepare", "Copy", "Verify"},
		Run: func(_ context.Context, job *Job) error {
			job.Stage(0)
			job.Logf("prepared %d devices", 2)
			job.Stage(1)
			job.Progress(150, 100, "bytes")
			job.Detail("Copying")
			<-release
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		record, _ := manager.Get(operation.ID)
		if record.Stages[1].Detail == "Copying" {
			if record.Stages[0].State != Succeeded || record.Stages[1].Progress.Done != 100 || len(record.Log) != 1 {
				t.Fatalf("running record = %+v", record)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("progress was not reported")
		}
		time.Sleep(5 * time.Millisecond)
	}
	close(release)
	record := waitFor(t, manager, operation.ID, Succeeded)
	if record.Stages[1].State != Succeeded || record.Stages[2].State != Skipped || record.FinishedAt == nil {
		t.Fatalf("finished stages = %+v", record.Stages)
	}
	manager.Close()
	reopened := openManager(t, directory)
	list, err := reopened.List(10)
	if err != nil || len(list) != 1 || list[0].State != Succeeded {
		t.Fatalf("persisted list = %+v, %v", list, err)
	}
}

func TestFailureMarksTheCurrentStage(t *testing.T) {
	manager := openManager(t, t.TempDir())
	operation, err := manager.Start(Request{
		Kind: "test.failure", RequestedBy: "test", Stages: []string{"Check", "Apply"},
		Run: func(_ context.Context, job *Job) error {
			job.Stage(0)
			job.Stage(1)
			return errors.New("device busy")
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	record := waitFor(t, manager, operation.ID, Failed)
	if record.Error != "device busy" || record.Stages[0].State != Succeeded || record.Stages[1].State != Failed {
		t.Fatalf("failed record = %+v", record)
	}
}

func TestCancellation(t *testing.T) {
	manager := openManager(t, t.TempDir())
	started := make(chan struct{})
	blocking := func(ctx context.Context, job *Job) error {
		job.Stage(0)
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	running, err := manager.Start(Request{Kind: "test.scrub", RequestedBy: "test", Exclusive: true, Cancellable: true, Stages: []string{"Scrub"}, Run: blocking})
	if err != nil {
		t.Fatal(err)
	}
	var ran atomic.Bool
	queued, err := manager.Start(Request{Kind: "test.balance", RequestedBy: "test", Exclusive: true, Cancellable: true, Stages: []string{"Balance"},
		Run: func(context.Context, *Job) error { ran.Store(true); return nil }})
	if err != nil {
		t.Fatal(err)
	}
	fixed, err := manager.Start(Request{Kind: "test.partition", RequestedBy: "test", Stages: []string{"Partition"},
		Run: func(context.Context, *Job) error { time.Sleep(50 * time.Millisecond); return nil }})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Cancel(fixed.ID); !errors.Is(err, ErrNotCancellable) {
		t.Fatalf("non-cancellable cancel = %v", err)
	}
	<-started
	if operation, err := manager.Cancel(queued.ID); err != nil || operation.State != Cancelled {
		t.Fatalf("queued cancel = %+v, %v", operation, err)
	}
	if _, err := manager.Cancel(running.ID); err != nil {
		t.Fatal(err)
	}
	if record := waitFor(t, manager, running.ID, Cancelled); record.Stages[0].State != Cancelled {
		t.Fatalf("cancelled stage = %+v", record.Stages)
	}
	waitFor(t, manager, fixed.ID, Succeeded)
	if ran.Load() {
		t.Fatal("a cancelled queued operation started")
	}
}

func TestCloseInterruptsAndReopenRecordsInterruption(t *testing.T) {
	directory := t.TempDir()
	manager, err := Open(directory, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	running, err := manager.Start(Request{Kind: "test.replace", RequestedBy: "test", Exclusive: true, Stages: []string{"Replace"},
		Run: func(ctx context.Context, job *Job) error {
			job.Stage(0)
			close(started)
			<-ctx.Done()
			return ctx.Err()
		}})
	if err != nil {
		t.Fatal(err)
	}
	queued, err := manager.Start(Request{Kind: "test.add", RequestedBy: "test", Exclusive: true, Stages: []string{"Add"},
		Run: func(context.Context, *Job) error { return nil }})
	if err != nil {
		t.Fatal(err)
	}
	<-started
	manager.Close()
	if _, err := manager.Start(Request{Kind: "test.late", RequestedBy: "test", Stages: []string{"Late"}, Run: func(context.Context, *Job) error { return nil }}); !errors.Is(err, ErrClosed) {
		t.Fatalf("start after close = %v", err)
	}

	// A record left running by a crash is interrupted when the journal reopens
	crashedID, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	crashed := Record{Operation: Operation{ID: crashedID.String(), Kind: "test.crash", RequestedBy: "test",
		State: Running, Stages: []Stage{{Name: "Work", State: Running}}, CreatedAt: time.Now()}, Log: []LogEntry{}}
	store, err := openStore(directory)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.save(crashed); err != nil {
		t.Fatal(err)
	}
	_ = store.close()

	reopened := openManager(t, directory)
	for _, id := range []string{running.ID, queued.ID, crashed.ID} {
		record, err := reopened.Get(id)
		if err != nil || record.State != Interrupted || record.FinishedAt == nil {
			t.Fatalf("%s after restart = %+v, %v", id, record.Operation, err)
		}
	}
}

func TestRetentionDropsOldRecords(t *testing.T) {
	directory := t.TempDir()
	manager := openManager(t, directory)
	operation, err := manager.Start(Request{Kind: "test.old", RequestedBy: "test", Stages: []string{"Work"}, Run: func(context.Context, *Job) error { return nil }})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, manager, operation.ID, Succeeded)
	manager.Close()
	later, err := Open(directory, func() time.Time { return time.Now().Add(keepFor + time.Hour) })
	if err != nil {
		t.Fatal(err)
	}
	defer later.Close()
	if _, err := later.Get(operation.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired record = %v", err)
	}
}

func TestStartRejectsIncompleteRequests(t *testing.T) {
	manager := openManager(t, t.TempDir())
	if _, err := manager.Start(Request{Kind: "test", Stages: []string{"Work"}, Run: func(context.Context, *Job) error { return nil }}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing requester = %v", err)
	}
	if _, err := manager.Get("../../etc/passwd"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("path-like id = %v", err)
	}
}
