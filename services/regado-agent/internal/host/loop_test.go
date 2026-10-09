//go:build hosttest

package host

// Exercises inventory and pool reads against real Btrfs filesystems on loop devices
import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
)

func mustRun(t *testing.T, args ...string) string {
	t.Helper()
	output, err := command.Run(context.Background(), args...)
	if err != nil {
		t.Fatalf("%s: %v", strings.Join(args, " "), err)
	}
	return strings.TrimSpace(output)
}

// loopDevice attaches a sparse 1 GiB file; the backing name becomes the device identity
func loopDevice(t *testing.T, name string) string {
	t.Helper()
	file := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(file, 1<<30); err != nil {
		t.Fatal(err)
	}
	device := mustRun(t, "losetup", "--find", "--show", file)
	t.Cleanup(func() { _, _ = command.Run(context.Background(), "losetup", "--detach", device) })
	return device
}

func mountPool(t *testing.T, device string, options ...string) string {
	t.Helper()
	target := t.TempDir()
	args := []string{"mount"}
	if len(options) > 0 {
		args = append(args, "-o", strings.Join(options, ","))
	}
	mustRun(t, append(args, device, target)...)
	t.Cleanup(func() { _, _ = command.Run(context.Background(), "umount", target) })
	return target
}

func TestHostPoolFactsOnLoopDevices(t *testing.T) {
	ctx := context.Background()
	first := loopDevice(t, "pool-a.img")
	second := loopDevice(t, "pool-b.img")
	mustRun(t, "mkfs.btrfs", "-q", "-f", "-L", "kaordo", "-d", "raid1", "-m", "raid1", first, second)
	uuid := mustRun(t, "blkid", "-s", "UUID", "-o", "value", first)
	mount := mountPool(t, first)

	devices, err := Inventory(ctx, command.Run, uuid, Options{Loop: true})
	if err != nil {
		t.Fatal(err)
	}
	classes := map[string]Class{}
	for _, device := range devices {
		classes[device.ID] = device.Class
	}
	if classes["loop-pool-a.img"] != ClassPool || classes["loop-pool-b.img"] != ClassPool {
		t.Fatalf("loop classes = %v", classes)
	}
	pool, err := ReadPool(ctx, command.Run, mount, devices)
	if err != nil {
		t.Fatal(err)
	}
	if pool.UUID != uuid || len(pool.Members) != 2 || pool.DataProfiles[0] != "raid1" || pool.MetadataProfiles[0] != "raid1" {
		t.Fatalf("pool = %+v", pool)
	}
	identities := []string{pool.Members[0].DeviceID, pool.Members[1].DeviceID}
	if !strings.Contains(strings.Join(identities, ","), "loop-pool-b.img") {
		t.Fatalf("member identities = %v", identities)
	}
}

func TestHostPoolReportsAMissingMember(t *testing.T) {
	ctx := context.Background()
	first := loopDevice(t, "degraded-a.img")
	second := loopDevice(t, "degraded-b.img")
	mustRun(t, "mkfs.btrfs", "-q", "-f", "-d", "raid1", "-m", "raid1", first, second)
	mustRun(t, "losetup", "--detach", second)
	mustRun(t, "btrfs", "device", "scan", "--forget")
	mount := mountPool(t, first, "degraded")

	pool, err := ReadPool(ctx, command.Run, mount, nil)
	if err != nil {
		t.Fatal(err)
	}
	missing := 0
	for _, member := range pool.Members {
		if member.Missing {
			missing++
		}
	}
	if len(pool.Members) != 2 || missing != 1 {
		t.Fatalf("degraded members = %+v", pool.Members)
	}
}
