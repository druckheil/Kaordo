package host

// Checks SMART report parsing and that the monitor keeps evidence for sleeping disks
import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

const passingReport = `{"smartctl":{"exit_status":0},"smart_status":{"passed":true},"temperature":{"current":31},"power_on_time":{"hours":1200},"ata_smart_attributes":{"table":[{"id":5,"raw":{"value":0}},{"id":197,"raw":{"value":0}},{"id":198,"raw":{"value":0}}]}}`

func TestParseHealth(t *testing.T) {
	for _, fixture := range []struct {
		raw   string
		state HealthState
	}{
		{passingReport, HealthPassed},
		{strings.Replace(passingReport, `"passed":true`, `"passed":false`, 1), HealthFailed},
		{strings.Replace(passingReport, `"id":197,"raw":{"value":0}`, `"id":197,"raw":{"value":2}`, 1), HealthWarning},
		{`{"smartctl":{"exit_status":3}}`, HealthStandby},
		{`{"smartctl":{"exit_status":2}}`, HealthUnavailable},
		{"not JSON", HealthUnavailable},
	} {
		if got := ParseHealth(fixture.raw); got.State != fixture.state {
			t.Errorf("state = %s, want %s", got.State, fixture.state)
		}
	}
	report := ParseHealth(passingReport)
	if *report.TemperatureC != 31 || *report.PowerOnHours != 1200 || *report.PendingSectors != 0 {
		t.Fatalf("counters = %+v", report)
	}
}

func TestHealthMonitorKeepsLastReportWhileAsleep(t *testing.T) {
	devices := []Device{{ID: "wwn-0x1", Path: "/dev/sda"}, {Path: "/dev/sdz"}}
	reply := passingReport
	var commands []string
	run := func(_ context.Context, args ...string) (string, error) {
		commands = append(commands, strings.Join(args, " "))
		return reply, errors.New("SMART bitmask exit status")
	}
	clock := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	now := func() time.Time { return clock }
	var monitor HealthMonitor
	if monitor.Lookup("wwn-0x1") != nil {
		t.Fatal("report before the first read")
	}
	monitor.Refresh(context.Background(), run, devices, now)
	if len(commands) != 1 || commands[0] != "smartctl --json --all --nocheck=standby,3 /dev/sda" {
		t.Fatalf("commands = %q", commands)
	}
	first := monitor.Lookup("wwn-0x1")
	if first == nil || first.State != HealthPassed || !first.CheckedAt.Equal(clock) {
		t.Fatalf("first = %+v", first)
	}

	reply, clock = `{"smartctl":{"exit_status":3}}`, clock.Add(time.Hour)
	monitor.Refresh(context.Background(), run, devices, now)
	if asleep := monitor.Lookup("wwn-0x1"); asleep.State != HealthPassed || !asleep.CheckedAt.Equal(first.CheckedAt) {
		t.Fatalf("sleeping disk lost its evidence: %+v", asleep)
	}

	monitor.Refresh(context.Background(), run, nil, now)
	if monitor.Lookup("wwn-0x1") != nil {
		t.Fatal("removed device kept a report")
	}
}
