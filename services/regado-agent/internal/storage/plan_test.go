package storage

// Verifies that pool plans are safe, ordered and ask for confirmation before erasing data
import (
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
)

const tib = int64(1) << 40

func disk(id, serial string, class host.Class) host.Device {
	return host.Device{ID: id, Path: "/dev/" + id, Model: "Disk", Serial: serial, Size: tib, Class: class, Partitions: []host.Partition{}}
}

func twoDiskPool() ([]host.Device, host.Pool) {
	devices := []host.Device{disk("wwn-a", "A", host.ClassPool), disk("wwn-b", "B", host.ClassPool)}
	pool := host.Pool{
		Members: []host.Member{
			{DevID: 1, Size: tib, DeviceID: "wwn-a", Path: "/dev/wwn-a2"},
			{DevID: 2, Size: tib, DeviceID: "wwn-b", Path: "/dev/wwn-b2"},
		},
		DataProfiles: []string{"raid1"}, MetadataProfiles: []string{"raid1"},
		DeviceSize: 2 * tib, Allocated: tib / 10,
	}
	return devices, pool
}

func desiredPool(devices ...string) state.Pool {
	data := "raid1"
	if len(devices) == 1 {
		data = "single"
	}
	return state.Pool{Devices: devices, DataProfile: data, MetadataProfile: "auto"}
}

func kinds(plan Plan) string {
	names := []string{}
	for _, step := range plan.Steps {
		names = append(names, string(step.Kind))
	}
	return strings.Join(names, ",")
}

func TestMatchingPoolNeedsNoSteps(t *testing.T) {
	devices, pool := twoDiskPool()
	plan := PlanPool(desiredPool("wwn-a", "wwn-b"), devices, pool)
	if len(plan.Steps) != 0 || !plan.Ready() {
		t.Fatalf("plan = %+v", plan)
	}
}

func TestAddingABlankDiskConvertsMetadataToThreeCopies(t *testing.T) {
	devices, pool := twoDiskPool()
	devices = append(devices, disk("wwn-c", "C", host.ClassBlank))
	plan := PlanPool(desiredPool("wwn-a", "wwn-b", "wwn-c"), devices, pool)
	if kinds(plan) != "add,convert" || !plan.Ready() {
		t.Fatalf("plan = %+v", plan)
	}
	if plan.Steps[0].Confirm != "" || plan.Steps[1].Data != "raid1" || plan.Steps[1].Metadata != "raid1c3" {
		t.Fatalf("steps = %+v", plan.Steps)
	}
}

func TestAddingADiskWithDataRequiresItsSerial(t *testing.T) {
	devices, pool := twoDiskPool()
	devices = append(devices, disk("wwn-c", "SERIAL-C", host.ClassForeign))
	plan := PlanPool(desiredPool("wwn-a", "wwn-b", "wwn-c"), devices, pool)
	if plan.Steps[0].Confirm != "SERIAL-C" || !strings.HasPrefix(plan.Steps[0].Summary, "Erase") {
		t.Fatalf("step = %+v", plan.Steps[0])
	}
}

func TestUnsafeAdditionsAreRefused(t *testing.T) {
	system := disk("wwn-sys", "S", host.ClassForeign)
	system.HostsSystem = true
	mounted := disk("usb-photos", "P", host.ClassForeign)
	mounted.Partitions = []host.Partition{{Path: "/dev/usb1", Mountpoints: []string{"/media/photos"}}}
	tiny := disk("usb-card", "T", host.ClassBlank)
	tiny.Size = 4 << 30
	for _, candidate := range []host.Device{system, mounted, tiny} {
		devices, pool := twoDiskPool()
		devices = append(devices, candidate)
		plan := PlanPool(desiredPool("wwn-a", "wwn-b", candidate.ID), devices, pool)
		if plan.Ready() || len(plan.Steps) != 1 || plan.Steps[0].Kind != StepConvert {
			t.Errorf("%s: plan = %+v", candidate.ID, plan)
		}
	}
	devices, pool := twoDiskPool()
	if plan := PlanPool(desiredPool("wwn-a", "wwn-b", "wwn-gone"), devices, pool); plan.Ready() || !strings.Contains(plan.Issues[0], "not connected") {
		t.Fatalf("disconnected device plan = %+v", plan)
	}
}

func TestAReplacementRebuildsTheMissingMember(t *testing.T) {
	devices, pool := twoDiskPool()
	devices = []host.Device{devices[0], disk("wwn-new", "N", host.ClassBlank)}
	pool.Members[1] = host.Member{DevID: 2, Missing: true, Path: "<missing disk #2>"}

	waiting := PlanPool(desiredPool("wwn-a", "wwn-b"), devices, pool)
	if len(waiting.Steps) != 0 || !waiting.Ready() {
		t.Fatalf("a missing device that is still desired needs no step: %+v", waiting)
	}
	plan := PlanPool(desiredPool("wwn-a", "wwn-new"), devices, pool)
	if kinds(plan) != "replace" || plan.Steps[0].Replaces != 2 || plan.Steps[0].Device != "wwn-new" {
		t.Fatalf("plan = %+v", plan)
	}
}

func TestRemovalConvertsProfilesFirstAndChecksCapacity(t *testing.T) {
	devices, pool := twoDiskPool()
	devices = append(devices, disk("wwn-c", "C", host.ClassPool))
	pool.Members = append(pool.Members, host.Member{DevID: 3, Size: tib, DeviceID: "wwn-c", Path: "/dev/wwn-c2"})
	pool.MetadataProfiles, pool.DeviceSize = []string{"raid1c3"}, 3*tib

	plan := PlanPool(desiredPool("wwn-a", "wwn-b"), devices, pool)
	if kinds(plan) != "convert,remove" || plan.Steps[0].Metadata != "raid1" || plan.Steps[1].Device != "wwn-c" || !plan.Ready() {
		t.Fatalf("plan = %+v", plan)
	}

	pool.Allocated = 2 * tib
	if crowded := PlanPool(desiredPool("wwn-a", "wwn-b"), devices, pool); crowded.Ready() {
		t.Fatalf("removal without room was allowed: %+v", crowded)
	}

	pool.Allocated = tib / 10
	devices[2].HostsSystem = true
	if system := PlanPool(desiredPool("wwn-a", "wwn-b"), devices, pool); system.Ready() {
		t.Fatalf("removing the system disk was allowed: %+v", system)
	}
}

func TestDroppingAMissingDeviceKeepsOneCopyOnTheSurvivor(t *testing.T) {
	devices, pool := twoDiskPool()
	devices = devices[:1]
	pool.Members[1] = host.Member{DevID: 2, Missing: true, Path: "<missing disk #2>"}
	plan := PlanPool(desiredPool("wwn-a"), devices, pool)
	if kinds(plan) != "convert,remove" || plan.Steps[0].Data != "single" || plan.Steps[0].Metadata != "dup" || plan.Steps[1].Replaces != 2 {
		t.Fatalf("plan = %+v", plan)
	}
}
