package host

// Parses recorded lsblk and btrfs output for device classification and pool facts
import (
	"context"
	"os"
	"strings"
	"testing"
)

const poolUUID = "e1b53e8e-ac0b-414d-9b60-f6e58597357c"

func fixtureRunner(t *testing.T, files map[string]string) func(context.Context, ...string) (string, error) {
	t.Helper()
	return func(_ context.Context, args ...string) (string, error) {
		key := strings.Join(args[:min(3, len(args))], " ")
		name, ok := files[key]
		if !ok {
			t.Fatalf("unexpected command %q", strings.Join(args, " "))
		}
		data, err := os.ReadFile("testdata/" + name)
		return string(data), err
	}
}

func TestInventoryClassifiesDevices(t *testing.T) {
	run := fixtureRunner(t, map[string]string{"lsblk --json --bytes": "lsblk.json"})
	devices, err := Inventory(context.Background(), run, poolUUID, Options{})
	if err != nil {
		t.Fatal(err)
	}
	classes := map[string]Class{}
	system := map[string]bool{}
	for _, device := range devices {
		classes[device.Path] = device.Class
		system[device.Path] = device.HostsSystem
	}
	want := map[string]Class{
		"/dev/sda": ClassPool, "/dev/sdb": ClassPool, "/dev/sdc": ClassBlank,
		"/dev/sdd": ClassForeign, "/dev/sde": ClassBackup, "/dev/sdf": ClassUnidentified,
	}
	if len(devices) != len(want) {
		t.Fatalf("devices = %+v", devices)
	}
	for path, class := range want {
		if classes[path] != class {
			t.Errorf("%s class = %s, want %s", path, classes[path], class)
		}
	}
	if !system["/dev/sdb"] || system["/dev/sda"] {
		t.Fatalf("system flags = %v", system)
	}
	if devices[0].ID != "usb-Kingston_DataTraveler_0004-0:0" && devices[0].ID != "" {
		t.Fatalf("devices are not sorted by identity: %s", devices[0].ID)
	}
}

func TestInventoryNamesLoopDevicesOnlyForHostTests(t *testing.T) {
	original := loopBackingFile
	loopBackingFile = func(name string) string {
		if name == "loop0" {
			return "/tmp/disk-a.img"
		}
		return ""
	}
	t.Cleanup(func() { loopBackingFile = original })
	run := fixtureRunner(t, map[string]string{"lsblk --json --bytes": "lsblk.json"})
	devices, err := Inventory(context.Background(), run, poolUUID, Options{Loop: true})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, device := range devices {
		if device.Path == "/dev/loop0" {
			found = device.ID == "loop-disk-a.img" && device.Class == ClassBlank
		}
	}
	if !found {
		t.Fatalf("loop device missing or misnamed: %+v", devices)
	}
}

func TestReadPoolMapsMembersProfilesAndErrors(t *testing.T) {
	run := fixtureRunner(t, map[string]string{
		"lsblk --json --bytes":   "lsblk.json",
		"btrfs filesystem show":  "show.txt",
		"btrfs filesystem usage": "usage.txt",
		"btrfs device stats":     "stats.txt",
	})
	devices, err := Inventory(context.Background(), run, poolUUID, Options{})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := ReadPool(context.Background(), run, "/srv/kaordo", devices)
	if err != nil {
		t.Fatal(err)
	}
	if pool.UUID != poolUUID || pool.Label != "kaordo" || len(pool.Members) != 2 {
		t.Fatalf("pool = %+v", pool)
	}
	if pool.Members[0].DeviceID != "wwn-0x50014ee000000002" || pool.Members[1].DeviceID != "wwn-0x50014ee000000001" {
		t.Fatalf("member identities = %+v", pool.Members)
	}
	if pool.Members[1].Errors.Read != 3 || pool.Members[1].Errors.Corruption != 1 || pool.Members[0].Errors.Total() != 0 {
		t.Fatalf("member errors = %+v", pool.Members)
	}
	if len(pool.DataProfiles) != 2 || pool.MetadataProfiles[0] != "raid1" || pool.DataRatio != 2 {
		t.Fatalf("profiles = %v %v %v", pool.DataProfiles, pool.MetadataProfiles, pool.DataRatio)
	}
	if pool.Used != 15011774464 || pool.FreeEstimated != 948171849728 || pool.DeviceSize != 1931685355520 {
		t.Fatalf("capacity = %+v", pool)
	}
}

func TestReadPoolReportsMissingMembers(t *testing.T) {
	run := fixtureRunner(t, map[string]string{
		"lsblk --json --bytes":   "lsblk.json",
		"btrfs filesystem show":  "show-missing.txt",
		"btrfs filesystem usage": "usage.txt",
		"btrfs device stats":     "stats.txt",
	})
	pool, err := ReadPool(context.Background(), run, "/srv/kaordo", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !pool.Members[1].Missing || pool.Members[1].DevID != 2 || pool.Members[0].Missing {
		t.Fatalf("members = %+v", pool.Members)
	}
}
