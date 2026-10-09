package integrity

// Checks scrub counters, SMART self-test parsing and the self-test flow with a scripted smartctl
import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
)

func TestParseScrubCountersSumsDevices(t *testing.T) {
	raw := "UUID: x\n\tcorrected_errors: 3\n\tuncorrectable_errors: 0\n\tcorrected_errors: 2\n\tuncorrectable_errors: 1\n"
	if got := ParseScrubCounters(raw); got != (ScrubResult{Corrected: 5, Uncorrectable: 1}) {
		t.Fatalf("counters = %+v", got)
	}
}

func TestSelfTestParsing(t *testing.T) {
	for _, fixture := range []struct {
		name, raw string
		running   bool
		percent   int64
		failure   string
	}{
		{"ATA running", `{"ata_smart_data":{"self_test":{"status":{"value":249,"remaining_percent":90}}}}`, true, 10, ""},
		{"ATA passed", `{"ata_smart_data":{"self_test":{"status":{"value":0}}},"ata_smart_self_test_log":{"standard":{"table":[{"status":{"passed":true,"string":"Completed without error"}}]}}}`, false, 100, ""},
		{"ATA read failure", `{"ata_smart_data":{"self_test":{"status":{"value":121}}},"ata_smart_self_test_log":{"standard":{"table":[{"status":{"passed":false,"string":"Completed: read failure"}}]}}}`, false, 100, "Completed: read failure"},
		{"NVMe running", `{"nvme_self_test_log":{"current_self_test_operation":{"value":1},"current_self_test_completion_percent":40}}`, true, 40, ""},
		{"NVMe passed", `{"nvme_self_test_log":{"current_self_test_operation":{"value":0},"table":[{"self_test_result":{"value":0,"string":"Completed without error"}}]}}`, false, 100, ""},
		{"no log", `{}`, false, 100, "the device reported no self-test result"},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			running, percent := selfTestProgress(fixture.raw)
			if running != fixture.running || percent != fixture.percent {
				t.Fatalf("progress = %v %d", running, percent)
			}
			if running {
				return
			}
			err := selfTestVerdict(fixture.raw)
			if fixture.failure == "" && err != nil || fixture.failure != "" && (err == nil || err.Error() != fixture.failure) {
				t.Fatalf("verdict = %v, want %q", err, fixture.failure)
			}
		})
	}
}

// scriptedSMART answers smartctl like two ATA drives: the first passes, the second has a read failure
type scriptedSMART struct {
	mu       sync.Mutex
	polls    map[string]int
	commands []string
}

func (smart *scriptedSMART) run(_ context.Context, args ...string) (string, error) {
	smart.mu.Lock()
	defer smart.mu.Unlock()
	smart.commands = append(smart.commands, strings.Join(args, " "))
	device := args[len(args)-1]
	switch args[2] {
	case "--test=long":
		// smartctl reports drive health in the exit bitmask even when the command worked
		return `{"smartctl":{"exit_status":64}}`, errors.New("exit status 64")
	case "--capabilities":
		smart.polls[device]++
		if smart.polls[device] == 1 {
			return `{"ata_smart_data":{"self_test":{"status":{"value":249,"remaining_percent":50}}}}`, nil
		}
		passed, result := "true", "Completed without error"
		if device == "/dev/sdb" {
			passed, result = "false", "Completed: read failure"
		}
		return `{"ata_smart_data":{"self_test":{"status":{"value":0}}},"ata_smart_self_test_log":{"standard":{"table":[{"status":{"passed":` + passed + `,"string":"` + result + `"}}]}}}`, nil
	}
	return "", errors.New("unexpected smartctl call")
}

func TestSelfTestRunsEachDeviceAndReportsFailures(t *testing.T) {
	smart := &scriptedSMART{polls: map[string]int{}}
	checker := Checker{Run: smart.run, Poll: time.Millisecond}
	devices := []host.Device{{ID: "wwn-a", Path: "/dev/sda", Serial: "WD-A"}, {ID: "wwn-b", Path: "/dev/sdb", Serial: "WD-B"}}
	manager, err := operation.Open(t.TempDir(), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	started, err := manager.Start(operation.Request{
		Kind: KindSMARTLong, RequestedBy: "test", Cancellable: true, Stages: []string{"WD-A", "WD-B"},
		Run: func(ctx context.Context, job *operation.Job) error {
			return checker.SelfTest(ctx, job, KindSMARTLong, devices)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	record := waitFinished(t, manager, started.ID)
	if record.State != operation.Failed || record.Error != "the long self-test failed on WD-B" {
		t.Fatalf("record = %s %q", record.State, record.Error)
	}
	if record.Stages[0].State != operation.Succeeded || record.Stages[1].State != operation.Failed {
		t.Fatalf("stages = %+v", record.Stages)
	}
	if smart.commands[0] != "smartctl --json --test=long /dev/sda" || smart.commands[1] != "smartctl --json --capabilities --log=selftest /dev/sda" {
		t.Fatalf("commands = %q", smart.commands)
	}
}

func waitFinished(t *testing.T, manager *operation.Manager, id string) operation.Record {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		record, err := manager.Get(id)
		if err != nil {
			t.Fatal(err)
		}
		if record.State.Finished() {
			return record
		}
		if time.Now().After(deadline) {
			t.Fatalf("operation stayed %s", record.State)
		}
		time.Sleep(5 * time.Millisecond)
	}
}
