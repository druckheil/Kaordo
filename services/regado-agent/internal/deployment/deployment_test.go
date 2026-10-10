package deployment

// Exercises idempotent attempts, interrupted installations and durable deployment history
import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func write(t *testing.T, directory, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func systemd(state string, started *[]string) func(context.Context, ...string) (string, error) {
	return func(_ context.Context, args ...string) (string, error) {
		if args[1] == "start" {
			*started = append(*started, strings.Join(args, " "))
		}
		return "ActiveState=" + state + "\nResult=timeout\nExecMainStatus=9\n", nil
	}
}

func TestStoppedUnitCannotRemainDeploying(t *testing.T) {
	for _, phase := range []string{"download", "activation", "rollback"} {
		t.Run(phase, func(t *testing.T) {
			directory := t.TempDir()
			var started []string
			write(t, directory, "7.json", `{"run":7,"attempt":1,"state":"deploying","hostChanged":`+strconv.FormatBool(phase != "download")+`,"phase":"`+phase+`"}`)
			deployments := Deployments{Run: systemd("failed", &started), Directory: directory}
			record, err := deployments.Status(context.Background(), 7)
			if err != nil || record.State != Failed || record.FinishedAt == nil || record.Error.Phase != phase || !strings.Contains(record.Message, "timeout") {
				t.Fatalf("status = %+v, %v", record, err)
			}
			if record.RollbackFailed != (phase != "download") {
				t.Fatalf("rollback = %+v", record)
			}
			persisted, _, err := deployments.record(7)
			if err != nil || persisted.State != Failed {
				t.Fatalf("persisted = %+v, %v", persisted, err)
			}
		})
	}
}

func TestAttemptIsQueuedOnceAndRetryNeedsANewAttempt(t *testing.T) {
	ctx := context.Background()
	var started []string
	deployments := Deployments{Run: systemd("active", &started), Directory: t.TempDir()}
	request := Request{Run: 9, Attempt: 1, Revision: strings.Repeat("a", 40)}
	var workers sync.WaitGroup
	for range 8 {
		workers.Go(func() {
			if _, err := deployments.Start(ctx, request); err != nil {
				t.Error(err)
			}
		})
	}
	workers.Wait()
	if len(started) != 1 || started[0] != "systemctl start --no-block kaordo-deploy@9-1.service" {
		t.Fatalf("started = %q", started)
	}
	if _, err := deployments.Start(ctx, Request{Run: 9, Attempt: 2, Revision: request.Revision}); !errors.Is(err, ErrAttemptActive) {
		t.Fatalf("active retry = %v", err)
	}
	write(t, deployments.Directory, "9.json", `{"run":9,"attempt":1,"state":"failed","message":"download stalled"}`)
	if record, err := deployments.Start(ctx, request); err != nil || record.Message != "download stalled" || len(started) != 1 {
		t.Fatalf("duplicate final request = %+v, %v", record, err)
	}
	deployments.Run = systemd("inactive", &started)
	request.Attempt++
	if record, err := deployments.Start(ctx, request); err != nil || record.Attempt != 2 || record.State != Waiting || len(started) != 2 {
		t.Fatalf("new attempt = %+v, %v", record, err)
	}
}

func TestStartFailureIsPersistedAndInvalidRequestsCannotLaunch(t *testing.T) {
	deployments := Deployments{Directory: t.TempDir(), Run: func(_ context.Context, args ...string) (string, error) {
		if args[1] == "show" {
			return "ActiveState=failed\n", nil
		}
		return "", errors.New("systemd unavailable")
	}}
	if _, err := deployments.Start(context.Background(), Request{Run: 1, Attempt: 1, Revision: "bad"}); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	record, err := deployments.Start(context.Background(), Request{Run: 1, Attempt: 1, Revision: strings.Repeat("a", 40)})
	if err != nil || record.State != Failed || !strings.Contains(record.Message, "systemd unavailable") {
		t.Fatalf("failed launch = %+v, %v", record, err)
	}
	if latest, err := deployments.Latest(context.Background()); err != nil || latest.State != Failed {
		t.Fatalf("latest = %+v, %v", latest, err)
	}
}

func TestHistoryAndUnknownRuns(t *testing.T) {
	ctx := context.Background()
	deployments := Deployments{Directory: filepath.Join(t.TempDir(), "absent")}
	if latest, err := deployments.Latest(ctx); latest != nil || err != nil {
		t.Fatalf("empty = %+v, %v", latest, err)
	}
	if _, err := deployments.Status(ctx, 7); !errors.Is(err, ErrUnknownRun) {
		t.Fatal(err)
	}
	deployments.Directory = t.TempDir()
	write(t, deployments.Directory, "99.json", `{"run":99,"state":"failed"}`)
	write(t, deployments.Directory, "100.json", `{"run":100,"state":"succeeded","events":[{"sequence":1,"at":"2026-10-10T12:00:00Z"}]}`)
	write(t, deployments.Directory, "999", "not a record")
	items, err := deployments.List(ctx)
	if err != nil || len(items) != 2 || items[0].Run != 100 || len(items[0].Events) != 0 {
		t.Fatalf("history = %+v, %v", items, err)
	}
	write(t, deployments.Directory, "101.json", `{`)
	if _, err := deployments.Latest(ctx); err == nil {
		t.Fatal("corrupt record was accepted")
	}
}

func TestFreshQueueWaitsForSystemdButAbandonedQueueFails(t *testing.T) {
	var started []string
	deployments := Deployments{Directory: t.TempDir(), Run: systemd("inactive", &started)}
	now := time.Now().UTC()
	if err := deployments.write(Record{Run: 7, Attempt: 1, State: Waiting, Phase: "queued", UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	if record, err := deployments.Status(context.Background(), 7); err != nil || record.State != Waiting {
		t.Fatalf("fresh queue = %+v, %v", record, err)
	}
	if err := deployments.write(Record{Run: 7, Attempt: 1, State: Waiting, Phase: "queued", UpdatedAt: now.Add(-time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if record, err := deployments.Status(context.Background(), 7); err != nil || record.State != Failed {
		t.Fatalf("abandoned queue = %+v, %v", record, err)
	}
}

func TestStoppingUnitCanFinishRollbackBeforeReconciliation(t *testing.T) {
	var started []string
	deployments := Deployments{Directory: t.TempDir(), Run: systemd("deactivating", &started)}
	write(t, deployments.Directory, "7.json", `{"run":7,"attempt":1,"state":"deploying","phase":"rollback","hostChanged":true,"rollback":"running"}`)
	record, err := deployments.Status(context.Background(), 7)
	if err != nil || record.State != Deploying || record.RollbackFailed {
		t.Fatalf("rollback while stopping = %+v, %v", record, err)
	}
}

func TestAcceptedJobOutlivesItsDisconnectedRequester(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	deployments := Deployments{Directory: t.TempDir(), Run: func(ctx context.Context, _ ...string) (string, error) {
		if err := ctx.Err(); err != nil {
			t.Fatalf("accepted dispatch inherited caller cancellation: %v", err)
		}
		return "ActiveState=active\n", nil
	}}
	record, err := deployments.Start(ctx, Request{Run: 7, Attempt: 1, Revision: strings.Repeat("a", 40)})
	if err != nil || record.State != Waiting {
		t.Fatalf("acceptance = %+v, %v", record, err)
	}
}
