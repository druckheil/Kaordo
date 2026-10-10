//go:build hosttest

package storage

// Applies pool plans with real btrfs-progs and sgdisk on loop devices and verifies stored data survives
import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/hosttest"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
)

const gib = int64(1) << 30

// facts reads the inventory and pool the way the agent does
func facts(t *testing.T, mount string) ([]host.Device, host.Pool) {
	t.Helper()
	ctx := context.Background()
	pool, err := host.ReadPool(ctx, command.Run, mount, nil)
	if err != nil {
		t.Fatal(err)
	}
	devices, err := host.Inventory(ctx, command.Run, pool.UUID, host.Options{Loop: true})
	if err != nil {
		t.Fatal(err)
	}
	pool, err = host.ReadPool(ctx, command.Run, mount, devices)
	if err != nil {
		t.Fatal(err)
	}
	return devices, pool
}

func apply(t *testing.T, mount string, desired state.Pool) (operation.Record, Plan) {
	t.Helper()
	devices, pool := facts(t, mount)
	plan := PlanPool(desired, devices, pool)
	if !plan.Ready() {
		t.Fatalf("plan issues: %v", plan.Issues)
	}
	manager, err := operation.Open(t.TempDir(), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	executor := Executor{Run: command.Run, Mount: mount, Poll: 50 * time.Millisecond}
	started, err := manager.Start(operation.Request{
		Kind: "pool.apply", RequestedBy: "test", Exclusive: true, Cancellable: true, Stages: Stages(plan),
		Run: func(ctx context.Context, job *operation.Job) error { return executor.Apply(ctx, job, plan, devices) },
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Minute)
	for {
		record, err := manager.Get(started.ID)
		if err != nil {
			t.Fatal(err)
		}
		if record.State.Finished() {
			if record.State != operation.Succeeded {
				t.Fatalf("operation %s: %s; log %+v", record.State, record.Error, record.Log)
			}
			return record, plan
		}
		if time.Now().After(deadline) {
			t.Fatalf("operation still %s at stage %+v", record.State, record.Stages)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// writeData stores 64 MiB of random data and returns its checksum
func writeData(t *testing.T, mount string) string {
	t.Helper()
	file := filepath.Join(mount, "data.bin")
	hosttest.MustRun(t, "dd", "if=/dev/urandom", "of="+file, "bs=1M", "count=64", "status=none")
	hosttest.MustRun(t, "sync")
	return checksum(t, mount)
}

func checksum(t *testing.T, mount string) string {
	t.Helper()
	return strings.Fields(hosttest.MustRun(t, "sha256sum", filepath.Join(mount, "data.bin")))[0]
}

func loopID(device string) string {
	return "loop-" + filepath.Base(device)
}

func TestHostAddDiskConvertsMetadataToThreeCopies(t *testing.T) {
	first, second := hosttest.Disk(t, "add-a.img", 2*gib), hosttest.Disk(t, "add-b.img", 2*gib)
	hosttest.Disk(t, "add-c.img", 10*gib)
	hosttest.MustRun(t, "mkfs.btrfs", "-q", "-f", "-d", "raid1", "-m", "raid1", first, second)
	mount := hosttest.Mount(t, first)
	sum := writeData(t, mount)

	record, plan := apply(t, mount, state.Pool{Devices: []string{"loop-add-a.img", "loop-add-b.img", "loop-add-c.img"}, DataProfile: "raid1", MetadataProfile: "auto"})
	if len(plan.Steps) != 2 || record.Stages[0].State != operation.Succeeded || record.Stages[1].State != operation.Succeeded {
		t.Fatalf("stages = %+v", record.Stages)
	}
	devices, pool := facts(t, mount)
	if len(pool.Members) != 3 || pool.MetadataProfiles[0] != "raid1c3" || pool.DataProfiles[0] != "raid1" {
		t.Fatalf("pool after add = %+v", pool)
	}
	for _, device := range devices {
		if device.ID == "loop-add-c.img" && (len(device.Partitions) != 2 || device.Partitions[1].Label != "kaordo-pool" || device.Class != host.ClassPool) {
			t.Fatalf("added device = %+v", device)
		}
	}
	if checksum(t, mount) != sum {
		t.Fatal("data changed while adding a device")
	}
}

func TestHostReplaceRebuildsAMissingDisk(t *testing.T) {
	first, second := hosttest.Disk(t, "replace-a.img", 2*gib), hosttest.Disk(t, "replace-b.img", 2*gib)
	hosttest.Disk(t, "replace-c.img", 10*gib)
	hosttest.MustRun(t, "mkfs.btrfs", "-q", "-f", "-d", "raid1", "-m", "raid1", first, second)
	healthy := hosttest.Mount(t, first)
	sum := writeData(t, healthy)
	hosttest.MustRun(t, "umount", healthy)
	hosttest.Forget(t, second)
	mount := hosttest.Mount(t, first, "degraded")

	record, plan := apply(t, mount, state.Pool{Devices: []string{"loop-replace-a.img", "loop-replace-c.img"}, DataProfile: "raid1", MetadataProfile: "auto"})
	if plan.Steps[0].Kind != StepReplace || record.Stages[0].Progress == nil {
		t.Fatalf("replace plan %+v, stages %+v", plan, record.Stages)
	}
	_, pool := facts(t, mount)
	for _, member := range pool.Members {
		if member.Missing {
			t.Fatalf("pool still misses a member: %+v", pool.Members)
		}
	}
	if len(pool.Members) != 2 || checksum(t, mount) != sum {
		t.Fatalf("pool after replace = %+v", pool)
	}
	scrub := hosttest.MustRun(t, "btrfs", "scrub", "start", "-B", mount)
	if !strings.Contains(scrub, "no errors found") && !strings.Contains(scrub, "Error summary:    no errors") {
		t.Fatalf("scrub after replace: %s", scrub)
	}
}

func TestHostRemoveConvertsMetadataFirst(t *testing.T) {
	first, second, third := hosttest.Disk(t, "remove-a.img", 2*gib), hosttest.Disk(t, "remove-b.img", 2*gib), hosttest.Disk(t, "remove-c.img", 2*gib)
	hosttest.MustRun(t, "mkfs.btrfs", "-q", "-f", "-d", "raid1", "-m", "raid1c3", first, second, third)
	mount := hosttest.Mount(t, first)
	sum := writeData(t, mount)

	_, plan := apply(t, mount, state.Pool{Devices: []string{"loop-remove-a.img", "loop-remove-b.img"}, DataProfile: "raid1", MetadataProfile: "auto"})
	if len(plan.Steps) != 2 || plan.Steps[0].Kind != StepConvert || plan.Steps[1].Kind != StepRemove {
		t.Fatalf("plan = %+v", plan)
	}
	devices, pool := facts(t, mount)
	if len(pool.Members) != 2 || pool.MetadataProfiles[0] != "raid1" || checksum(t, mount) != sum {
		t.Fatalf("pool after remove = %+v", pool)
	}
	for _, device := range devices {
		if device.ID == loopID(third) && device.Class != host.ClassBlank {
			t.Fatalf("removed device was not cleared: %+v", device)
		}
	}
}

func TestHostDroppingAMissingDiskKeepsTheSurvivor(t *testing.T) {
	first, second := hosttest.Disk(t, "drop-a.img", 2*gib), hosttest.Disk(t, "drop-b.img", 2*gib)
	hosttest.MustRun(t, "mkfs.btrfs", "-q", "-f", "-d", "raid1", "-m", "raid1", first, second)
	healthy := hosttest.Mount(t, first)
	sum := writeData(t, healthy)
	hosttest.MustRun(t, "umount", healthy)
	hosttest.Forget(t, second)
	mount := hosttest.Mount(t, first, "degraded")

	apply(t, mount, state.Pool{Devices: []string{"loop-drop-a.img"}, DataProfile: "single", MetadataProfile: "auto"})
	_, pool := facts(t, mount)
	if len(pool.Members) != 1 || pool.DataProfiles[0] != "single" || pool.MetadataProfiles[0] != "dup" || checksum(t, mount) != sum {
		t.Fatalf("pool after dropping the missing device = %+v", pool)
	}
}
