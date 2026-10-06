package main

// Checks SMART report parsing and monitor cache behavior
import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestSMARTHealthAndCache(t *testing.T) {
	good := `{"smartctl":{"exit_status":0},"smart_status":{"passed":true},"temperature":{"current":31},"power_on_time":{"hours":1200},"ata_smart_attributes":{"table":[{"id":5,"raw":{"value":0}},{"id":197,"raw":{"value":0}},{"id":198,"raw":{"value":0}}]}}`
	for _, fixture := range []struct{ raw, state string }{
		{good, "passed"},
		{strings.Replace(good, `"passed":true`, `"passed":false`, 1), "failed"},
		{strings.Replace(good, `"id":197,"raw":{"value":0}`, `"id":197,"raw":{"value":2}`, 1), "warning"},
		{`{"smartctl":{"exit_status":3}}`, "standby"},
		{`{"smartctl":{"exit_status":2}}`, "unavailable"},
		{"not JSON", "unavailable"},
	} {
		if got := parseSMART(fixture.raw); got.State != fixture.state {
			t.Fatalf("state = %s, want %s", got.State, fixture.state)
		}
	}
	monitor := &smartMonitor{entries: make(map[string]smartHealth)}
	calls := 0
	run := func(_ context.Context, args ...string) (string, error) {
		calls++
		if strings.Join(args, " ") != "smartctl --json --all --nocheck=standby,3 /dev/sda" {
			t.Fatalf("unexpected SMART command: %v", args)
		}
		return good, errors.New("SMART bitmask exit status")
	}
	first, available := monitor.read(run, "/dev/sda")
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) && (!available || first.State != "passed") {
		time.Sleep(time.Millisecond)
		first, available = monitor.read(run, "/dev/sda")
	}
	second, secondAvailable := monitor.read(run, "/dev/sda")
	if calls != 1 || !available || !secondAvailable || first.State != "passed" || !first.CheckedAt.Equal(second.CheckedAt) {
		t.Fatalf("cached SMART result = %+v / %+v, calls %d", first, second, calls)
	}
	if physicalDevice.MatchString("/dev/../../etc/shadow") || physicalDevice.MatchString("/dev/zram0") {
		t.Fatal("nonphysical device accepted")
	}
}
