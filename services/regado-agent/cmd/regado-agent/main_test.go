package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseMirrorAndAllowlist(t *testing.T) {
	profile := "Data, RAID1: total=2147483648, used=60837888\nMetadata, RAID1: total=1073741824, used=2277376\nSystem, RAID1: total=33554432, used=16384"
	stats := "[/dev/sdb3].write_io_errs 0\n[/dev/sda2].read_io_errs 0"
	healthy := parseMirror(profile, stats, "Status: finished", 2)
	if !healthy.Healthy || healthy.MirroredPercent != 100 {
		t.Fatalf("mirror = %+v", healthy)
	}
	degraded := parseMirror(strings.Replace(profile, "Data, RAID1", "Data, single", 1), stats, "", 2)
	if degraded.Healthy || degraded.MirroredPercent != 0 {
		t.Fatalf("degraded mirror = %+v", degraded)
	}
	failed := parseMirror(profile, "[/dev/sda2].corruption_errs 1", "", 2)
	if failed.Healthy || failed.DeviceErrors != 1 {
		t.Fatalf("failed mirror = %+v", failed)
	}
	mixed := parseMirror("Data, single: total=100, used=60837888\n"+profile, stats, "", 2)
	if mixed.Healthy || mixed.MirroredPercent != 50 || mixed.DataProfile != "mixed" {
		t.Fatalf("mixed mirror = %+v", mixed)
	}
	if validService("../../etc/shadow") {
		t.Fatal("arbitrary journal unit accepted")
	}
	called := false
	handler := newHandler(func(context.Context, ...string) (string, error) { called = true; return "", nil })
	for _, path := range []string{"/actions/restart-kerno", "/actions/reboot", "/actions/../../etc"} {
		request := httptest.NewRequest(http.MethodPost, path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code == http.StatusOK || called {
			t.Fatalf("unsafe action %q accepted", path)
		}
	}
}
