//go:build hosttest

// Package hosttest provides loop-device fixtures for tests that run real storage tools as root.
package hosttest

// Attaches sparse loop disks with partition scanning and mounts filesystems with cleanup
import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
)

// MustRun runs a host tool and fails the test on error.
func MustRun(t *testing.T, args ...string) string {
	t.Helper()
	output, err := command.Run(context.Background(), args...)
	if err != nil {
		t.Fatalf("%s: %v", strings.Join(args, " "), err)
	}
	return strings.TrimSpace(output)
}

// Disk attaches a sparse file as a partition-scanning loop device. The backing file name
// becomes the device identity ("loop-<name>") that the inventory reports.
func Disk(t *testing.T, name string, size int64) string {
	t.Helper()
	file := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(file, size); err != nil {
		t.Fatal(err)
	}
	device := MustRun(t, "losetup", "--find", "--show", "--partscan", file)
	t.Cleanup(func() { _, _ = command.Run(context.Background(), "losetup", "--detach", device) })
	return device
}

// Mount mounts device on a temporary directory until the test ends.
func Mount(t *testing.T, device string, options ...string) string {
	t.Helper()
	target := t.TempDir()
	args := []string{"mount"}
	if len(options) > 0 {
		args = append(args, "-o", strings.Join(options, ","))
	}
	MustRun(t, append(args, device, target)...)
	t.Cleanup(func() { _, _ = command.Run(context.Background(), "umount", target) })
	return target
}

// Forget drops a loop device from the Btrfs device cache and detaches it to simulate a lost
// disk. Only this device is forgotten: a bare --forget would unregister other tests' pools too.
func Forget(t *testing.T, device string) {
	t.Helper()
	MustRun(t, "btrfs", "device", "scan", "--forget", device)
	MustRun(t, "losetup", "--detach", device)
}
