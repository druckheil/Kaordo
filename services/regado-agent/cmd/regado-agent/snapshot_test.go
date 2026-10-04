package main

// Verifies physical disk discovery, swap parsing, and operational disk states
import (
	"context"
	"strings"
	"testing"
)

func TestReadDisksOmitsZramFromPhysicalInventory(t *testing.T) {
	raw := `{"blockdevices":[
		{"name":"sda","path":"/dev/sda","type":"disk","size":100,"serial":"disk-a","mountpoints":[],"children":[]},
		{"name":"zram0","path":"/dev/zram0","type":"disk","size":20,"serial":null,"mountpoints":[],"children":[]}
	]}`
	disks, err := readDisks(context.Background(), func(_ context.Context, args ...string) (string, error) {
		if args[0] == "parted" {
			return "BYT;\n/dev/sda:100B:scsi:512:512:gpt:fixture:;\n1:0B:99B:100B:free;", nil
		}
		if args[0] != "lsblk" {
			t.Fatalf("unexpected command: %v", args)
		}
		return raw, nil
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(disks) != 1 || disks[0].Path != "/dev/sda" {
		t.Fatalf("physical inventory = %+v", disks)
	}
}

func TestSwapParsingSeparatesCompressedRAMFromDiskSwap(t *testing.T) {
	items := parseSwapDevices("Filename Type Size Used Priority\n/dev/zram0 partition 4194304 1024 100\n/dev/sda3 partition 8388608 2048 -2\n/var/swapfile file 1024 0 1\n")
	if len(items) != 3 {
		t.Fatalf("swap devices = %+v", items)
	}
	if items[0].Kind != "compressed RAM" || items[0].Size != 4<<30 || items[0].Used != 1<<20 {
		t.Fatalf("zram stats = %+v", items[0])
	}
	if items[1].Kind != "disk swap" || items[1].Priority != -2 {
		t.Fatalf("disk swap = %+v", items[1])
	}
	if items[2].Kind != "swap file" {
		t.Fatalf("swap file = %+v", items[2])
	}
}

func TestStorageStateTracksPoolMembershipAndPendingBalance(t *testing.T) {
	root := "/"
	pool := "/srv/data"
	disks := []disk{
		{Name: "sda", Path: "/dev/sda", Type: "disk", Serial: stringPointer("a"), Children: []disk{{Path: "/dev/sda1", Type: "part", Mountpoints: []*string{&root}}}},
		{Name: "sdb", Path: "/dev/sdb", Type: "disk", Serial: stringPointer("b"), Children: []disk{{Path: "/dev/sdb1", Type: "part"}}},
		{Name: "sdc", Path: "/dev/sdc", Type: "disk", Serial: stringPointer("c")},
	}
	mounts := []mount{{Path: pool, FSType: "btrfs", Integrity: &filesystemIntegrity{Members: []string{"/dev/sdb1"}, BalanceRunning: true}}}
	markSystemDisks(disks)
	markStorageStates(disks, mounts, nil)
	if disks[0].StorageState != "working" || disks[1].StorageState != "queued" || disks[2].StorageState != "unconfigured" || !disks[2].ConfigureEligible {
		t.Fatalf("disk states = %+v", disks)
	}
}

func TestDiskSetupIsQueuedAndExistingPartitionsRequireAReview(t *testing.T) {
	device := disk{Path: "/dev/sdc", Type: "disk", Serial: stringPointer("c"), Children: []disk{{
		Path: "/dev/sdc1", Type: "part", PartitionLabel: stringPointer("kaordo-data"), Mountpoints: []*string{},
	}}}
	eligible, _ := diskConfigureEligibility(device, nil)
	if eligible {
		t.Fatal("an existing partition must not use blank-disk setup")
	}
	if state := device.Children[0].PartitionLabel; state == nil || *state != "kaordo-data" {
		t.Fatalf("partition marker = %v", state)
	}

	setStorageSetupInProgress("/dev/sdc", true)
	defer setStorageSetupInProgress("/dev/sdc", false)
	disks := []disk{device}
	markStorageStates(disks, nil, nil)
	if disks[0].StorageState != "queued" || disks[0].ConfigureEligible {
		t.Fatalf("active setup state = %+v", disks[0])
	}

	setStorageSetupInProgress("/dev/sdc", false)
	disks = []disk{device}
	markStorageStates(disks, nil, nil)
	if disks[0].StorageState != "unconfigured" || disks[0].ConfigureEligible {
		t.Fatalf("review-required state = %+v", disks[0])
	}
}

func TestUnconfiguredDiskMustBeBlankAndHaveStableIdentity(t *testing.T) {
	blank := disk{Path: "/dev/sdc", Type: "disk", Serial: stringPointer("unique"), Mountpoints: []*string{}}
	if eligible, _ := diskConfigureEligibility(blank, nil); !eligible {
		t.Fatal("empty physical disk should be eligible")
	}
	partitioned := blank
	partitioned.Children = []disk{{Path: "/dev/sdc1", Type: "part"}}
	if eligible, _ := diskConfigureEligibility(partitioned, nil); eligible {
		t.Fatal("partitioned disk should not be eligible")
	}
	if eligible, _ := diskConfigureEligibility(disk{Path: "/dev/sdd", Type: "disk"}, nil); eligible {
		t.Fatal("disk without stable identity should not be eligible")
	}
	if eligible, _ := diskConfigureEligibility(blank, []swapDevice{{Path: "/dev/sdc"}}); eligible {
		t.Fatal("active swap disk should not be eligible")
	}
	if !strings.HasPrefix(deviceIdentity(blank), "serial:") {
		t.Fatal("stable serial identity was not selected")
	}
}

func stringPointer(value string) *string { return &value }
