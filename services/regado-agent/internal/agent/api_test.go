package agent

// Checks filesystem integrity parsing and the HTTP action allowlist
import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseFilesystemIntegrityAndAllowlist(t *testing.T) {
	profile := "Data, RAID1: total=2147483648, used=60837888\nMetadata, RAID1: total=1073741824, used=2277376\nSystem, RAID1: total=33554432, used=16384"
	stats := "[/dev/sdb3].write_io_errs 0\n[/dev/sda2].read_io_errs 0"
	devices := "Label: 'Data1' uuid: E1B53E8E-AC0B-414D-9B60-F6E58597357C\nTotal devices 2\n devid 1 size 100 used 50 path /dev/sdb3\n devid 2 size 100 used 50 path /dev/sda2"
	scrub := "Status: finished\nError summary: no errors found"
	healthy := parseFilesystemIntegrity(profile, stats, scrub, devices, "No balance found", 2, 2)
	if !healthy.Healthy || healthy.MirroredPercent != 100 {
		t.Fatalf("filesystem integrity = %+v", healthy)
	}
	if healthy.UUID != "e1b53e8e-ac0b-414d-9b60-f6e58597357c" || len(healthy.Members) != 2 || healthy.ScrubState != "complete" {
		t.Fatalf("filesystem pool metadata = %+v", healthy)
	}
	singleProfile := parseFilesystemIntegrity(strings.Replace(profile, "Data, RAID1", "Data, single", 1), stats, "", devices, "", 2, 2)
	if singleProfile.Healthy || singleProfile.MirroredPercent != 0 {
		t.Fatalf("single-profile filesystem = %+v", singleProfile)
	}
	failed := parseFilesystemIntegrity(profile, "[/dev/sda2].corruption_errs 1", "", devices, "", 2, 2)
	if failed.Healthy || failed.DeviceErrors != 1 {
		t.Fatalf("filesystem errors = %+v", failed)
	}
	mixed := parseFilesystemIntegrity("Data, single: total=100, used=60837888\n"+profile, stats, "", devices, "", 2, 2)
	if mixed.Healthy || mixed.MirroredPercent != 50 || mixed.DataProfile != "mixed" {
		t.Fatalf("mixed profile = %+v", mixed)
	}
	if validService("../../etc/shadow") {
		t.Fatal("arbitrary journal unit accepted")
	}
	called := false
	monitor := newReplicationMonitor()
	t.Cleanup(monitor.Close)
	handler := newHandler(func(context.Context, ...string) (string, error) { called = true; return "", nil }, monitor)
	for _, path := range []string{"/actions/restart-kerno", "/actions/reboot", "/actions/../../etc"} {
		request := httptest.NewRequest(http.MethodPost, path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code == http.StatusOK || called {
			t.Fatalf("unsafe action %q accepted", path)
		}
	}
}
