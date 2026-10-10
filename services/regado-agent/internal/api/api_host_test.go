//go:build hosttest

package api

// Drives the agent's HTTP API against a real Btrfs pool: adoption, plans, confirmations and convergence
import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/alert"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/hosttest"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/integrity"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/storage"
)

const gib = int64(1) << 30

func newService(t *testing.T, mount string) (*Service, http.Handler) {
	t.Helper()
	states, err := state.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(states.Close)
	operations, err := operation.Open(t.TempDir(), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(operations.Close)
	alerts, err := alert.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(alerts.Close)
	service := &Service{
		Run: command.Run, Host: Host{Name: "test", Firmware: "bios", PoolMount: mount}, Inventory: host.Options{Loop: true},
		States: states, Operations: operations, Alerts: alerts,
		Executor: storage.Executor{Run: command.Run, Mount: mount, Poll: 50 * time.Millisecond},
	}
	if err := service.Adopt(context.Background()); err != nil {
		t.Fatal(err)
	}
	return service, NewHandler(service, nil)
}

func call(t *testing.T, handler http.Handler, method, path string, body any, target any) int {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(method, path, &payload))
	if target != nil && recorder.Code == http.StatusOK {
		if err := json.Unmarshal(recorder.Body.Bytes(), target); err != nil {
			t.Fatal(err)
		}
	}
	return recorder.Code
}

func TestHostAPIAdoptsThenConvergesOnADesiredDisk(t *testing.T) {
	first, second := hosttest.Disk(t, "api-a.img", 2*gib), hosttest.Disk(t, "api-b.img", 2*gib)
	hosttest.Disk(t, "api-c.img", 10*gib)
	foreign := hosttest.Disk(t, "api-d.img", 10*gib)
	hosttest.MustRun(t, "mkfs.ext4", "-q", foreign)
	hosttest.MustRun(t, "mkfs.btrfs", "-q", "-f", "-d", "raid1", "-m", "raid1", first, second)
	_, handler := newService(t, hosttest.Mount(t, first))

	var facts Facts
	if code := call(t, handler, http.MethodGet, "/host", nil, &facts); code != http.StatusOK {
		t.Fatalf("GET /host = %d", code)
	}
	if facts.Desired.Revision != 1 || len(facts.Desired.Pool.Devices) != 2 || len(facts.Drift.Steps) != 0 || !facts.Drift.Ready() {
		t.Fatalf("adopted host = %+v", facts.Desired.Pool)
	}

	withForeign := facts.Desired
	withForeign.Pool.Devices = append(append([]string{}, facts.Desired.Pool.Devices...), "loop-api-d.img")
	var plan storage.Plan
	if code := call(t, handler, http.MethodPost, "/state/plan", withForeign, &plan); code != http.StatusOK || plan.Steps[0].Confirm == "" {
		t.Fatalf("foreign plan %d = %+v", code, plan)
	}
	change := Change{Document: withForeign, Reason: "Grow the pool", RequestedBy: "admin"}
	if code := call(t, handler, http.MethodPut, "/state", change, nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("unconfirmed erase = %d", code)
	}

	grown := facts.Desired
	grown.Pool.Devices = append(append([]string{}, facts.Desired.Pool.Devices...), "loop-api-c.img")
	var result ChangeResult
	if code := call(t, handler, http.MethodPut, "/state", Change{Document: grown, Reason: "Grow the pool", RequestedBy: "admin"}, &result); code != http.StatusOK {
		t.Fatalf("PUT /state = %d", code)
	}
	if result.Document.Revision != 2 || result.Operation == nil || result.Previous == nil {
		t.Fatalf("change result = %+v", result)
	}
	if code := call(t, handler, http.MethodPut, "/state", Change{Document: grown, Reason: "Again", RequestedBy: "admin"}, nil); code != http.StatusConflict {
		t.Fatalf("stale revision = %d", code)
	}

	deadline := time.Now().Add(2 * time.Minute)
	for {
		var record operation.Record
		if code := call(t, handler, http.MethodGet, "/operations/"+result.Operation.ID, nil, &record); code != http.StatusOK {
			t.Fatalf("GET operation = %d", code)
		}
		if record.State.Finished() {
			if record.State != operation.Succeeded {
				t.Fatalf("apply %s: %s", record.State, record.Error)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("apply did not finish")
		}
		time.Sleep(100 * time.Millisecond)
	}
	if code := call(t, handler, http.MethodGet, "/host", nil, &facts); code != http.StatusOK || len(facts.Drift.Steps) != 0 || len(facts.Pool.Members) != 3 {
		t.Fatalf("converged host %d: drift %+v members %d", code, facts.Drift, len(facts.Pool.Members))
	}
	var list struct{ Items []operation.Operation }
	if code := call(t, handler, http.MethodGet, "/operations?limit=5", nil, &list); code != http.StatusOK || len(list.Items) != 1 {
		t.Fatalf("operations = %d %+v", code, list)
	}
	if code := call(t, handler, http.MethodPost, "/operations/01999111-2222-7333-8444-000000000000/cancel", nil, nil); code != http.StatusNotFound {
		t.Fatalf("cancel unknown = %d", code)
	}
}

func TestHostAPIRunsChecksOnRequest(t *testing.T) {
	first, second := hosttest.Disk(t, "check-a.img", 2*gib), hosttest.Disk(t, "check-b.img", 2*gib)
	hosttest.MustRun(t, "mkfs.btrfs", "-q", "-f", "-d", "raid1", "-m", "raid1", first, second)
	mount := hosttest.Mount(t, first)
	service, handler := newService(t, mount)
	service.Integrity = integrity.Checker{Run: command.Run, Mount: mount, Poll: 50 * time.Millisecond}

	if code := call(t, handler, http.MethodPost, "/operations", CheckRequest{Kind: "integrity.reboot", Reason: "Check", RequestedBy: "admin"}, nil); code != http.StatusBadRequest {
		t.Fatalf("unknown check = %d", code)
	}
	if code := call(t, handler, http.MethodPost, "/operations", CheckRequest{Kind: integrity.KindScrub}, nil); code != http.StatusBadRequest {
		t.Fatalf("check without a requesting account = %d", code)
	}
	// Loop devices have no SMART, so once read they are excluded from self-tests
	devices, err := host.Inventory(context.Background(), command.Run, "", service.Inventory)
	if err != nil {
		t.Fatal(err)
	}
	service.Health.Refresh(context.Background(), command.Run, devices, time.Now)
	if code := call(t, handler, http.MethodPost, "/operations", CheckRequest{Kind: integrity.KindSMARTShort, Reason: "Weekly", RequestedBy: "admin"}, nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("self-test without SMART devices = %d", code)
	}

	// A healthy two-disk pool without a backup target raises only that warning
	if err := service.EvaluateAlerts(context.Background()); err != nil {
		t.Fatal(err)
	}
	var report AlertReport
	if code := call(t, handler, http.MethodGet, "/alerts?after=0", nil, &report); code != http.StatusOK {
		t.Fatalf("GET /alerts = %d", code)
	}
	if len(report.Events) != 1 || report.Events[0].Key != "backup.none" || report.Events[0].Kind != alert.Opened || report.Host != "test" {
		t.Fatalf("alert report = %+v", report)
	}

	var started operation.Operation
	if code := call(t, handler, http.MethodPost, "/operations", CheckRequest{Kind: integrity.KindScrub, RequestedBy: "admin"}, &started); code != http.StatusOK {
		t.Fatalf("scrub = %d", code)
	}
	if started.Kind != integrity.KindScrub || started.RequestedBy != "admin" || started.Target != mount {
		t.Fatalf("started = %+v", started)
	}
	deadline := time.Now().Add(time.Minute)
	for {
		var record operation.Record
		call(t, handler, http.MethodGet, "/operations/"+started.ID, nil, &record)
		if record.State.Finished() {
			if record.State != operation.Succeeded {
				t.Fatalf("scrub %s: %s", record.State, record.Error)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("scrub did not finish")
		}
		time.Sleep(50 * time.Millisecond)
	}
}
