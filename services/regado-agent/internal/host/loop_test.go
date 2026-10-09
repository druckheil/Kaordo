//go:build hosttest

package host

// Exercises inventory and pool reads against real Btrfs filesystems on loop devices
import (
	"context"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/hosttest"
)

func TestHostPoolFactsOnLoopDevices(t *testing.T) {
	ctx := context.Background()
	first := hosttest.Disk(t, "pool-a.img", 1<<30)
	second := hosttest.Disk(t, "pool-b.img", 1<<30)
	hosttest.MustRun(t, "mkfs.btrfs", "-q", "-f", "-L", "kaordo", "-d", "raid1", "-m", "raid1", first, second)
	uuid := hosttest.MustRun(t, "blkid", "-s", "UUID", "-o", "value", first)
	mount := hosttest.Mount(t, first)

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
	first := hosttest.Disk(t, "degraded-a.img", 1<<30)
	second := hosttest.Disk(t, "degraded-b.img", 1<<30)
	hosttest.MustRun(t, "mkfs.btrfs", "-q", "-f", "-d", "raid1", "-m", "raid1", first, second)
	hosttest.Forget(t, second)
	mount := hosttest.Mount(t, first, "degraded")

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
