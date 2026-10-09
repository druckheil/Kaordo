package alert

// Verifies alert transitions, persistence and the conditions derived from host facts
import (
	"slices"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/storage"
)

func kinds(events []Event) []string {
	result := []string{}
	for _, event := range events {
		result = append(result, string(event.Kind)+" "+event.Key)
	}
	return result
}

func TestTrackerRecordsTransitionsOnceAndSurvivesRestarts(t *testing.T) {
	directory := t.TempDir()
	tracker, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 10, 10, 3, 0, 0, 0, time.UTC)
	usage := Condition{Key: "pool.usage", Severity: Warning, Summary: "The pool is 82% full."}
	missing := Condition{Key: "pool.missing.2", Severity: Critical, Summary: "Device 2 is missing."}
	steps := [][]Condition{
		{usage},
		{usage, missing},
		{{Key: "pool.usage", Severity: Critical, Summary: "The pool is 93% full."}, missing},
		{{Key: "pool.usage", Severity: Critical, Summary: "The pool is 94% full."}},
		{},
		{usage},
	}
	for index, conditions := range steps {
		if err := tracker.Update(conditions, start.Add(time.Duration(index)*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	want := []string{"opened pool.usage", "opened pool.missing.2", "escalated pool.usage", "resolved pool.missing.2", "resolved pool.usage", "opened pool.usage"}
	if got := kinds(tracker.Read(0).Events); !slices.Equal(got, want) {
		t.Fatalf("events = %q", got)
	}
	tracker.Close()

	reopened, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	report := reopened.Read(4)
	if report.Sequence != 6 || !slices.Equal(kinds(report.Events), want[4:]) {
		t.Fatalf("after restart = %d %q", report.Sequence, kinds(report.Events))
	}
	if open := report.Alerts[0]; open.Key != "pool.usage" || open.ResolvedAt != nil || !open.FirstSeen.Equal(start.Add(5*time.Minute)) {
		t.Fatalf("reopened alert = %+v", open)
	}
	if resolved := report.Alerts[1]; resolved.Key != "pool.missing.2" || resolved.ResolvedAt == nil {
		t.Fatalf("resolved alert = %+v", resolved)
	}
	if err := reopened.Update([]Condition{usage}, start.Add(31*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if alerts := reopened.Read(0).Alerts; len(alerts) != 1 {
		t.Fatalf("resolved alerts were not pruned: %+v", alerts)
	}
}

func healthyInputs() Inputs {
	passed := &host.Health{State: host.HealthPassed}
	return Inputs{
		Devices: []host.Device{
			{ID: "wwn-a", Model: "WDC", Serial: "WD-A", Class: host.ClassPool, Health: passed},
			{ID: "wwn-b", Model: "WDC", Serial: "WD-B", Class: host.ClassPool, Health: passed},
			{ID: "wwn-c", Serial: "USB-1", Class: host.ClassForeign, Health: &host.Health{State: host.HealthFailed}},
		},
		Pool: host.Pool{
			Members:      []host.Member{{DevID: 1, DeviceID: "wwn-a"}, {DevID: 2, DeviceID: "wwn-b"}},
			DataProfiles: []string{"raid1"}, MetadataProfiles: []string{"raid1"},
			Used: 200, FreeEstimated: 400, DataRatio: 2,
		},
		Desired: func() state.Document {
			document := state.Default([]string{"wwn-0x50014ee0aaaa0001", "wwn-0x50014ee0aaaa0002"})
			document.Backups.Targets = []state.BackupTarget{{ID: "usb", Kind: "disk", Device: "usb-backup"}}
			return document
		}(),
	}
}

func keys(conditions []Condition) []string {
	result := []string{}
	for _, condition := range conditions {
		result = append(result, string(condition.Severity)+" "+condition.Key)
	}
	slices.Sort(result)
	return result
}

func TestEvaluateReportsOnlyActionableConditions(t *testing.T) {
	if got := Evaluate(healthyInputs()); len(got) != 0 {
		t.Fatalf("a healthy host raised %+v", got)
	}

	in := healthyInputs()
	in.Pool.Members[1].Missing = true
	in.Pool.Members[0].Errors.Corruption = 3
	in.Devices[1].Health = &host.Health{State: host.HealthWarning}
	in.Pool.Used, in.Pool.FreeEstimated = 1800, 100
	in.Drift = storage.Plan{Steps: []storage.Step{{Kind: "replace"}}}
	in.Desired.Backups.Targets = nil
	in.Operations = []operation.Operation{
		{Kind: "integrity.scrub", State: operation.Failed, Error: "scrub found damaged data that no copy could repair: 2 blocks"},
		{Kind: "integrity.smart-short", State: operation.Interrupted},
		{Kind: "integrity.smart-short", State: operation.Succeeded},
	}
	want := []string{
		"critical device.errors.1", "critical operation.integrity.scrub", "critical pool.missing.2", "critical pool.usage",
		"warning backup.none", "warning device.smart.wwn-b", "warning pool.drift",
	}
	got := Evaluate(in)
	if !slices.Equal(keys(got), want) {
		t.Fatalf("conditions = %q", keys(got))
	}
	for _, condition := range got {
		if condition.Key == "device.errors.1" && condition.Summary != "WDC (WD-A) recorded 3 read, write or checksum errors." {
			t.Fatalf("summary = %q", condition.Summary)
		}
	}

	in.Operations = append([]operation.Operation{{Kind: "pool.apply", State: operation.Running}}, in.Operations...)
	if slices.Contains(keys(Evaluate(in)), "warning pool.drift") {
		t.Fatal("drift was reported while a pool change converges")
	}
}
