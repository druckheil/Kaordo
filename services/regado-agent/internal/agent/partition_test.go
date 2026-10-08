package agent

// Verifies declarative layouts, native preview validation and mutation guards without touching a device
import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const testGiB int64 = 1 << 30

func TestPlanIdentityDoesNotMutateInventory(t *testing.T) {
	device := nativeLayoutDevice()
	device.Health = &smartHealth{State: "passed"}
	device.Children[0].Health = &smartHealth{State: "passed"}
	device.Children[0].StorageState = "working"
	identity := planIdentity(device)
	if identity.Health != nil || identity.Children[0].Health != nil || identity.Children[0].StorageState != "" {
		t.Fatal("volatile counters entered the fingerprint")
	}
	if device.Health == nil || device.Children[0].Health == nil || device.Children[0].StorageState != "working" {
		t.Fatal("fingerprint creation changed the source inventory")
	}
}

func nativeLayoutDevice() disk {
	return disk{Name: "sdc", Path: "/dev/sdc", Type: "disk", Size: 8 * testGiB, Serial: stringPointer("layout-disk"), LayoutAvailable: true,
		Unallocated: []diskRegion{{Start: 3 * partitionAlignment, Size: 3*testGiB - 3*partitionAlignment}, {Start: 7 * testGiB, Size: testGiB - partitionAlignment}},
		Children: []disk{
			{Path: "/dev/sdc1", Type: "part", Number: 1, Start: partitionAlignment, Size: 2 * partitionAlignment, BootKind: "BIOS boot", Role: "system", PartitionType: stringPointer("21686148-6449-6e6f-744e-656564454649")},
			{Path: "/dev/sdc2", Type: "part", Number: 2, Start: 3 * testGiB, Size: 4 * testGiB, Role: "storage", FSType: stringPointer("btrfs"), PartitionType: stringPointer("0fc63daf-8483-4772-8e79-3d69d8477de4"), Mountpoints: []*string{stringPointer("/srv/data")}},
		},
	}
}

func nativeLayoutPreview(device disk) []repartPartition {
	return []repartPartition{
		{Label: "kaordo-system", Node: "/dev/sdc3", Number: 2, Offset: 3 * partitionAlignment, Size: testGiB, Activity: "create"},
		{Node: "/dev/sdc1", Number: 0, Offset: device.Children[0].Start, OldSize: device.Children[0].Size, Size: device.Children[0].Size, Activity: "unchanged"},
		{Node: "/dev/sdc2", Number: 1, Offset: device.Children[1].Start, OldSize: device.Children[1].Size, Size: device.Children[1].Size, Activity: "unchanged"},
	}
}

func TestBlankLayoutsUseDiskoForMixedAndBothExtremeAllocations(t *testing.T) {
	device := disk{Path: "/dev/sdc", Type: "disk", Size: 10 * testGiB}
	for _, allocation := range []struct{ system, storage int64 }{
		{testGiB, 8 * testGiB},
		{10*testGiB - bootMetadataBytes("uefi") - 4*partitionAlignment, 0},
		{0, 10*testGiB - 2*partitionAlignment},
	} {
		plan := buildStoragePlan(device, layoutRequest{Device: device.Path, SystemBytes: allocation.system, StorageBytes: allocation.storage})
		if !plan.Supported || plan.Backend != "disko" {
			t.Fatalf("layout = %+v", plan)
		}
		if strings.Contains(plan.Declaration, "destroy") || !strings.Contains(plan.Declaration, "disko.devices.disk.device") {
			t.Fatal("unexpected declarative configuration")
		}
	}
	overflow := buildStoragePlan(device, layoutRequest{Device: device.Path, SystemBytes: 10 * testGiB})
	if overflow.Supported {
		t.Fatal("GPT and boot metadata were not reserved")
	}
	for _, mode := range []string{"bios", "uefi"} {
		declaration := diskoDeclaration("/dev/sdc", "serial:fixture", testGiB, testGiB, mode)
		for _, required := range []string{"kaordo-system", "kaordo-storage", "ext4"} {
			if !strings.Contains(declaration, required) {
				t.Fatalf("missing %s", required)
			}
		}
		if strings.Contains(declaration, "EF00") != (mode == "uefi") || strings.Contains(declaration, "EF02") != (mode == "bios") {
			t.Fatalf("incorrect boot metadata for %s", mode)
		}
	}
	if !strings.Contains(diskoDeclaration("/dev/${injection}", "serial:fixture", testGiB, 0, "bios"), `\${`) {
		t.Fatal("Nix interpolation was not escaped")
	}
}

func TestGeneratedDiskoDeclarationMatchesTheLiveToolFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/storage-layout-bios.nix")
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != diskoDeclaration("/dev/sdc", "serial:fixture", testGiB, 2*testGiB, "bios") {
		t.Fatal("update the live-tool fixture to match the exported declaration")
	}
	other := diskoDeclaration("/dev/sdc", "serial:another-disk", testGiB, 2*testGiB, "bios")
	if strings.Contains(other, "02272746-730e-5859-a0e3-048ec3c83598") {
		t.Fatal("different disks share a System partition UUID")
	}
}

func TestPreparedStorageAreaCanBeActivatedWithoutFormatting(t *testing.T) {
	device := nativeLayoutDevice()
	part := &device.Children[1]
	part.PartitionLabel, part.FSType, part.Mountpoints = stringPointer("kaordo-storage"), nil, nil
	request := layoutRequest{Device: device.Path, StorageBytes: part.Size}
	plan := buildStoragePlan(device, request)
	if !plan.Supported {
		t.Fatalf("activation plan = %+v", plan)
	}
	preview := nativeLayoutPreview(device)[1:]
	raw, _ := json.Marshal(preview)
	steps, err := validatedRepartSteps(string(raw), device, plan)
	if err != nil || len(steps) != 1 || steps[0].Kind != "activate" {
		t.Fatalf("activation = %+v / %v", steps, err)
	}
	definitions, err := repartDefinitions(device, plan)
	if err != nil {
		t.Fatal(err)
	}
	for _, definition := range definitions {
		if strings.Contains(definition, "Format=") {
			t.Fatal("resuming prepared Storage would format existing partitions")
		}
	}
}

func TestExistingRolePlansPreserveRootAndRefuseShrinkAndUnmanagedData(t *testing.T) {
	device := nativeLayoutDevice()
	plan := buildStoragePlan(device, layoutRequest{Device: device.Path, SystemBytes: testGiB, StorageBytes: 4 * testGiB})
	if !plan.Supported || plan.Backend != "systemd-repart" {
		t.Fatalf("incremental layout = %+v", plan)
	}
	defs, err := repartDefinitions(device, plan)
	if err != nil || len(defs) != 3 || strings.Contains(defs["002-existing.conf"], "Format=") || !strings.Contains(defs["800-system.conf"], "Format=ext4") {
		t.Fatalf("definitions = %+v / %v", defs, err)
	}
	for _, request := range []layoutRequest{
		{Device: device.Path, StorageBytes: 3 * testGiB},
		{Device: device.Path, SystemBytes: testGiB, StorageBytes: 8 * testGiB},
		{Device: device.Path, StorageBytes: 4 * testGiB},
	} {
		if plan := buildStoragePlan(device, request); plan.Supported {
			t.Fatalf("unsafe or unchanged allocation accepted: %+v", plan)
		}
	}
	root := disk{Path: "/dev/sdc3", Type: "part", Size: testGiB, Role: "system", FSType: stringPointer("ext4"), Mountpoints: []*string{stringPointer("/")}}
	device.Children = append(device.Children, root)
	plan = buildStoragePlan(device, layoutRequest{Device: device.Path, SystemBytes: 2 * testGiB, StorageBytes: 4 * testGiB})
	if plan.Supported || !strings.Contains(strings.Join(plan.Issues, " "), "System area is protected") {
		t.Fatal("online root resize accepted")
	}
	device.Children[2].Role = "unassigned"
	if buildStoragePlan(device, layoutRequest{Device: device.Path, SystemBytes: testGiB, StorageBytes: 4 * testGiB}).Supported {
		t.Fatal("unmanaged filesystem accepted")
	}
}

func TestNativePreviewMustExactlyPreserveGeometryAndRequestedSizes(t *testing.T) {
	device := nativeLayoutDevice()
	plan := storagePlan{SystemBytes: testGiB, StorageBytes: 4 * testGiB}
	valid := nativeLayoutPreview(device)
	raw, _ := json.Marshal(valid)
	steps, err := validatedRepartSteps("warning\n"+string(raw)+"\nstatus", device, plan)
	if err != nil || len(steps) != 1 || steps[0].Source != "/dev/sdc3" {
		t.Fatalf("preview = %+v / %v", steps, err)
	}
	for _, corrupt := range []func([]repartPartition) []repartPartition{
		func(p []repartPartition) []repartPartition { p[1].Offset++; return p },
		func(p []repartPartition) []repartPartition { p[2].Size--; return p },
		func(p []repartPartition) []repartPartition { p[0].Size++; return p },
		func(p []repartPartition) []repartPartition { p[0].Label = "arbitrary"; return p },
		func(p []repartPartition) []repartPartition { p[0].Node = "/dev/sda3"; return p },
		func(p []repartPartition) []repartPartition { return p[:2] },
		func(p []repartPartition) []repartPartition { return append(p, p[1]) },
		func(p []repartPartition) []repartPartition { p[0].Offset = 3 * testGiB; return p },
	} {
		proposed := corrupt(slices.Clone(valid))
		raw, _ = json.Marshal(proposed)
		if _, err := validatedRepartSteps(string(raw), device, plan); err == nil {
			t.Fatalf("unsafe native preview accepted: %s", raw)
		}
	}
}

func TestApplyDelegatesExistingGeometryToRepartAndMountsOnlyNewSystemVolume(t *testing.T) {
	t.Setenv("REGADO_STORAGE_STATE", t.TempDir())
	device := nativeLayoutDevice()
	var applied, mounted bool
	var mutations []string
	base := replicationFixture("/srv/data", nil)
	run := func(ctx context.Context, args ...string) (string, error) {
		command := strings.Join(args, " ")
		switch args[0] {
		case "lsblk":
			raw, _ := json.Marshal(map[string]any{"blockdevices": []disk{device}})
			return string(raw), nil
		case "parted":
			if !slices.Contains(args, "print") {
				t.Fatalf("custom partition writer invoked: %v", args)
			}
			return "BYT;\n/dev/sdc:8589934592B:scsi:512:512:gpt:Fixture:;\n1:1048576B:3145727B:2097152B::boot:bios_grub;\n1:3145728B:3221225471B:3218079744B:free;\n2:3221225472B:7516192767B:4294967296B:btrfs:Data:;\n1:7516192768B:8588886015B:1072693248B:free;", nil
		case "systemd-repart":
			if slices.Contains(args, "--dry-run=false") {
				applied = true
				mutations = append(mutations, command)
				device.Children = append(device.Children, disk{Path: "/dev/sdc3", Type: "part", Size: testGiB, PartitionLabel: stringPointer("kaordo-system"), FSType: stringPointer("ext4")})
				return "[]", nil
			}
			raw, _ := json.Marshal(nativeLayoutPreview(device))
			return string(raw), nil
		case "sfdisk":
			return "label: gpt\n", nil
		case "udevadm":
			return "", nil
		case "blkid":
			return "11111111-2222-3333-4444-555555555555", nil
		case "systemd-mount":
			if !applied || args[len(args)-2] != "/dev/sdc3" {
				t.Fatalf("mounted an unexpected partition: %v", args)
			}
			mounted = true
			mutations = append(mutations, command)
			return "", nil
		case "btrfs":
			if len(args) > 2 && args[1] == "filesystem" && args[2] == "show" {
				return "Total devices 2\n devid 1 size 4294967296 used 100 path /dev/sdc2\n devid 2 size 4294967296 used 100 path /dev/sdb2", nil
			}
			return base(ctx, args...)
		default:
			return base(ctx, args...)
		}
	}
	request := layoutRequest{Device: "/dev/sdc", Identity: "serial:layout-disk", Filesystem: "/srv/data", SystemBytes: testGiB, StorageBytes: 4 * testGiB}
	plan, err := previewStoragePlan(context.Background(), run, request)
	if err != nil || !plan.Supported {
		t.Fatalf("preview = %+v / %v", plan, err)
	}
	request.Fingerprint, request.Confirmation = plan.Fingerprint, request.Device
	monitor := newReplicationMonitor()
	defer monitor.Close()
	if err := monitor.executeLayout(context.Background(), run, request); err != nil {
		t.Fatal(err)
	}
	if !applied || !mounted || len(mutations) != 2 {
		t.Fatalf("mutations = %+v", mutations)
	}
	entries, _ := os.ReadDir(storageStateDirectory())
	if len(entries) != 1 {
		t.Fatalf("approved workspace count = %d", len(entries))
	}
	if _, err := os.Stat(filepath.Join(storageStateDirectory(), entries[0].Name(), "partition-table.before")); err != nil {
		t.Fatal("existing partition table was not retained")
	}
}

func TestBlankSignatureAndChangedIdentityNeverReachDisko(t *testing.T) {
	t.Setenv("REGADO_STORAGE_STATE", t.TempDir())
	for _, identity := range []string{"serial:layout-disk", "serial:other"} {
		run := func(_ context.Context, args ...string) (string, error) {
			switch args[0] {
			case "lsblk":
				return `{"blockdevices":[{"path":"/dev/sdc","type":"disk","size":10737418240,"serial":"layout-disk"}]}`, nil
			case "parted":
				return "", errors.New("no table")
			case "wipefs":
				return "ext4", nil
			default:
				t.Fatalf("mutation during refused preview: %v", args)
				return "", nil
			}
		}
		plan, err := previewStoragePlan(context.Background(), run, layoutRequest{Device: "/dev/sdc", Identity: identity, SystemBytes: testGiB})
		if err == nil && plan.Supported {
			t.Fatal("existing signature or changed identity accepted")
		}
	}
	if validStorageTarget("/dev/../../etc/passwd") || validMountPath("/srv/data/../") {
		t.Fatal("unsafe paths accepted")
	}
}

func TestNativeProgressUsesOnlyRunningJobsAndMeasuredCounters(t *testing.T) {
	if parseScrubProgress("Status: finished\nTotal to scrub: 1000\nBytes scrubbed: 1000") != nil {
		t.Fatal("historical progress appeared on a new job")
	}
	progress := parseScrubProgress("Status: running\nTotal to scrub: 1000\nBytes scrubbed: 250\nStatus: running\nTotal to scrub: 1000\nBytes scrubbed: 750")
	if progress == nil || progress.Completed != 1000 || *progress.Total != 2000 {
		t.Fatalf("scrub progress = %+v", progress)
	}
	progress = parseBalanceProgress("50 out of about 100 chunks balanced (51 considered), 50% left")
	if progress == nil || progress.Completed != 50 || *progress.Total != 100 {
		t.Fatalf("balance progress = %+v", progress)
	}
	// Definitions remain integer byte allocations, rather than percentages inferred from elapsed time
	if !strings.Contains(partitionDefinition("linux-generic", "kaordo-system", testGiB, true), strconv.FormatInt(testGiB, 10)) {
		t.Fatal("native size allocation missing")
	}
}
