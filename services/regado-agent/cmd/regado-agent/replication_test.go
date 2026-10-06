package main

// Verifies detached copy checks, conservative classification, and safe repair preflight
import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func replicationFixture(path string, scrub func(context.Context, []string) (string, error)) commandRunner {
	return func(ctx context.Context, args ...string) (string, error) {
		command := strings.Join(args, " ")
		switch {
		case args[0] == "findmnt":
			raw, _ := json.Marshal(map[string]any{"filesystems": []map[string]string{{"target": path, "fstype": "btrfs"}}})
			return string(raw), nil
		case args[0] == "lsblk":
			return `{"blockdevices":[{"name":"sda","path":"/dev/sda","type":"disk","children":[{"path":"/dev/sda2","type":"part"}]},{"name":"sdb","path":"/dev/sdb","type":"disk","children":[{"path":"/dev/sdb2","type":"part"}]}]}`, nil
		case strings.HasPrefix(command, "btrfs scrub start "):
			return scrub(ctx, args)
		case strings.HasPrefix(command, "btrfs scrub status "):
			return "Status: finished\nError summary: no errors found\nStatus: finished\nError summary: no errors found", nil
		case strings.HasPrefix(command, "btrfs filesystem df "):
			return "Data, RAID1: total=4096, used=100\nMetadata, RAID1: total=4096, used=100\nSystem, RAID1: total=4096, used=100", nil
		case strings.HasPrefix(command, "btrfs filesystem show "):
			return "Total devices 2\n devid 1 size 900 used 100 path /dev/sda2\n devid 2 size 900 used 100 path /dev/sdb2", nil
		case strings.HasPrefix(command, "btrfs device stats "):
			return "[/dev/sda2].read_io_errs 0\n[/dev/sdb2].read_io_errs 0", nil
		case strings.HasPrefix(command, "btrfs balance status "):
			return "No balance found", nil
		case strings.HasPrefix(command, "btrfs filesystem usage "):
			return "Device size: 1800\nUsed: 600", nil
		default:
			return "", errors.New("unexpected command: " + command)
		}
	}
}

func TestCopyCheckSurvivesRequestCancellationAndRejectsConcurrentWork(t *testing.T) {
	path := t.TempDir()
	if err := os.WriteFile(filepath.Join(path, "file"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(outside, []byte("not included"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(path, "link")); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	run := replicationFixture(path, func(ctx context.Context, args []string) (string, error) {
		if !slices.Contains(args, "-r") || !slices.Contains(args, "-B") || !slices.Contains(args, "64m") {
			return "", errors.New("check was not read-only and rate-limited")
		}
		close(entered)
		select {
		case <-release:
			return "", nil
		case <-ctx.Done():
			return "", ctx.Err()
		}
	})
	monitor := newReplicationMonitor()
	t.Cleanup(monitor.Close)
	previous := time.Now().Add(-time.Hour)
	monitor.reports[path] = replicationReport{Path: path, State: "complete", CheckedAt: &previous, Files: 99, Duplication: "duplicated", ChecksumState: "passed"}
	request, cancel := context.WithCancel(context.Background())
	if err := monitor.start(request, run, path, false); err != nil {
		t.Fatal(err)
	}
	<-entered
	if report := monitor.status()[0]; report.CheckedAt != nil || report.Files != 0 {
		t.Fatal("new check reused stale inventory evidence")
	}
	cancel()
	if err := monitor.start(context.Background(), run, path, false); err == nil {
		t.Fatal("concurrent operation accepted")
	}
	close(release)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		report := monitor.status()[0]
		if report.State == "complete" {
			if report.Files != 1 || report.Bytes != 4 || report.Duplication != "duplicated" || report.ChecksumState != "passed" {
				t.Fatalf("copy report = %+v", report)
			}
			return
		}
		if report.State == "failed" {
			t.Fatalf("copy check failed: %+v", report)
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("copy check did not finish")
}

func TestRepairRefusesDevicesOnTheSamePhysicalDisk(t *testing.T) {
	path := t.TempDir()
	base := replicationFixture(path, func(context.Context, []string) (string, error) {
		t.Error("scrub started despite invalid devices")
		return "", nil
	})
	run := func(ctx context.Context, args ...string) (string, error) {
		if args[0] == "lsblk" {
			return `{"blockdevices":[{"name":"sda","path":"/dev/sda","type":"disk","children":[{"path":"/dev/sda2","type":"part"},{"path":"/dev/sdb2","type":"part"}]}]}`, nil
		}
		return base(ctx, args...)
	}
	monitor := newReplicationMonitor()
	defer monitor.Close()
	if err := monitor.start(context.Background(), run, path, true); err == nil {
		t.Fatal("same-disk repair accepted")
	}
	if len(monitor.status()) != 0 {
		t.Fatal("invalid repair started a worker")
	}
}

func TestCopyClassificationDoesNotInferMixedOrMissingPlacement(t *testing.T) {
	for _, test := range []struct {
		data, metadata, system string
		online, expected       int
		distinct               bool
		want                   string
	}{
		{"RAID1", "RAID1", "RAID1", 2, 2, true, "duplicated"},
		{"RAID1", "RAID1", "RAID1", 2, 2, false, "unverified"},
		{"RAID1", "RAID1", "RAID1", 1, 2, false, "single"},
		{"single", "DUP", "DUP", 1, 1, false, "single"},
		{"mixed", "RAID1", "RAID1", 2, 2, true, "unverified"},
		{"RAID1", "RAID1", "RAID1", 2, 3, false, "unverified"},
		{"RAID1C3", "RAID1C3", "RAID1C3", 3, 3, true, "duplicated"},
	} {
		pool := &filesystemIntegrity{DataProfile: test.data, MetadataProfile: test.metadata, SystemProfile: test.system, DevicesOnline: test.online, DevicesExpected: test.expected}
		if got := duplicationState(pool, test.distinct); got != test.want {
			t.Fatalf("%+v: got %s, want %s", pool, got, test.want)
		}
	}
	pool := &filesystemIntegrity{DataProfile: "RAID1C3", MetadataProfile: "DUP", SystemProfile: "DUP"}
	args := repairConversionArgs(pool, "/srv/data")
	if slices.ContainsFunc(args, func(arg string) bool { return strings.HasPrefix(arg, "-d") }) {
		t.Fatal("repair would reduce existing data redundancy")
	}
	if !slices.Contains(args, "-mprofiles=single|dup|raid0|raid5|raid6,convert=raid1,soft") || !slices.Contains(args, "-f") {
		t.Fatalf("conversion = %v", args)
	}
}
