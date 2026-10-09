// Package host reads physical devices and Btrfs pool facts through fixed host tools.
package host

// Lists physical devices with stable identities and classifies how each relates to the host's pool
import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
)

type Class string

const (
	ClassPool         Class = "pool"
	ClassBackup       Class = "backup"
	ClassBlank        Class = "blank"
	ClassForeign      Class = "foreign"
	ClassUnidentified Class = "unidentified"
)

// BackupLabel marks the independent filesystem of a backup-target disk.
const BackupLabel = "kaordo-backup"

type Partition struct {
	Path        string   `json:"path"`
	Number      int      `json:"number"`
	Size        int64    `json:"size"`
	Label       string   `json:"label"`
	Type        string   `json:"type"`
	FSType      string   `json:"fsType"`
	FSLabel     string   `json:"fsLabel"`
	FSUUID      string   `json:"fsUuid"`
	Mountpoints []string `json:"mountpoints"`
}

type Device struct {
	// ID is the device's /dev/disk/by-id name and the only identity the desired state uses.
	ID          string      `json:"id"`
	Path        string      `json:"path"`
	Model       string      `json:"model"`
	Serial      string      `json:"serial"`
	WWN         string      `json:"wwn"`
	Size        int64       `json:"size"`
	Rotational  bool        `json:"rotational"`
	Transport   string      `json:"transport"`
	FSType      string      `json:"fsType"`
	FSLabel     string      `json:"fsLabel"`
	FSUUID      string      `json:"fsUuid"`
	Mountpoints []string    `json:"mountpoints"`
	Partitions  []Partition `json:"partitions"`
	Class       Class       `json:"class"`
	// HostsSystem is set when the device carries /, /boot or /nix outside the pool.
	HostsSystem bool `json:"hostsSystem"`
}

type Options struct {
	// Loop includes loop devices; only the host test harness enables it.
	Loop bool
}

type blockDevice struct {
	Name         string        `json:"name"`
	Path         string        `json:"path"`
	Type         string        `json:"type"`
	IDLink       *string       `json:"id-link"`
	WWN          *string       `json:"wwn"`
	Serial       *string       `json:"serial"`
	Model        *string       `json:"model"`
	Size         int64         `json:"size"`
	Rotational   bool          `json:"rota"`
	Transport    *string       `json:"tran"`
	Number       *int          `json:"partn"`
	PartLabel    *string       `json:"partlabel"`
	PartTypeName *string       `json:"parttypename"`
	FSType       *string       `json:"fstype"`
	Label        *string       `json:"label"`
	UUID         *string       `json:"uuid"`
	Mountpoints  []*string     `json:"mountpoints"`
	Children     []blockDevice `json:"children"`
}

var unsafeIdentity = regexp.MustCompile(`[^A-Za-z0-9_.-]+`)

// loopBackingFile names the file behind a loop device; lsblk does not report it
var loopBackingFile = func(name string) string {
	data, err := os.ReadFile("/sys/block/" + filepath.Base(name) + "/loop/backing_file")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// Inventory lists physical devices. poolUUID identifies the host's pool; it may be empty.
func Inventory(ctx context.Context, run command.Runner, poolUUID string, options Options) ([]Device, error) {
	raw, err := run(ctx, "lsblk", "--json", "--bytes", "--output",
		"NAME,PATH,TYPE,ID-LINK,WWN,SERIAL,MODEL,SIZE,ROTA,TRAN,PARTN,PARTLABEL,PARTTYPENAME,FSTYPE,LABEL,UUID,MOUNTPOINTS")
	if err != nil {
		return nil, err
	}
	var listing struct {
		BlockDevices []blockDevice `json:"blockdevices"`
	}
	if err := json.Unmarshal([]byte(raw), &listing); err != nil {
		return nil, fmt.Errorf("parse lsblk: %w", err)
	}
	devices := make([]Device, 0, len(listing.BlockDevices))
	for _, block := range listing.BlockDevices {
		if !physical(block, options) {
			continue
		}
		device := toDevice(block)
		device.Class, device.HostsSystem = classify(device, poolUUID)
		devices = append(devices, device)
	}
	slices.SortFunc(devices, func(a, b Device) int { return strings.Compare(a.ID, b.ID) })
	return devices, nil
}

func physical(block blockDevice, options Options) bool {
	switch {
	case block.Size <= 0:
		return false
	case block.Type == "loop":
		return options.Loop && loopBackingFile(block.Name) != ""
	case block.Type != "disk":
		return false
	default:
		// zram and ram disks are memory, not storage
		return !strings.HasPrefix(block.Name, "zram") && !strings.HasPrefix(block.Name, "ram")
	}
}

func toDevice(block blockDevice) Device {
	device := Device{
		ID: value(block.IDLink), Path: block.Path, Model: strings.TrimSpace(value(block.Model)),
		Serial: strings.TrimSpace(value(block.Serial)), WWN: value(block.WWN), Size: block.Size,
		Rotational: block.Rotational, Transport: value(block.Transport), FSType: value(block.FSType),
		FSLabel: value(block.Label), FSUUID: value(block.UUID), Mountpoints: mountpoints(block.Mountpoints),
		Partitions: []Partition{},
	}
	if block.Type == "loop" {
		// Loop devices have no udev identity; the backing file names them in host tests
		device.ID = "loop-" + unsafeIdentity.ReplaceAllString(filepath.Base(loopBackingFile(block.Name)), "_")
		device.Serial = device.ID
	}
	for _, child := range block.Children {
		if child.Type != "part" {
			continue
		}
		number := 0
		if child.Number != nil {
			number = *child.Number
		}
		device.Partitions = append(device.Partitions, Partition{
			Path: child.Path, Number: number, Size: child.Size, Label: value(child.PartLabel),
			Type: value(child.PartTypeName), FSType: value(child.FSType), FSLabel: value(child.Label),
			FSUUID: value(child.UUID), Mountpoints: mountpoints(child.Mountpoints),
		})
	}
	return device
}

func classify(device Device, poolUUID string) (Class, bool) {
	if device.ID == "" {
		return ClassUnidentified, false
	}
	filesystems := append([]Partition{{FSType: device.FSType, FSLabel: device.FSLabel, FSUUID: device.FSUUID, Mountpoints: device.Mountpoints}}, device.Partitions...)
	inPool, backup, system := false, false, false
	for _, item := range filesystems {
		switch {
		case poolUUID != "" && item.FSUUID == poolUUID:
			inPool = true
		case item.FSType == "btrfs" && item.FSLabel == BackupLabel:
			backup = true
		case slices.ContainsFunc(item.Mountpoints, systemMount):
			system = true
		}
	}
	switch {
	case inPool:
		return ClassPool, system
	case backup:
		return ClassBackup, system
	case len(device.Partitions) == 0 && device.FSType == "":
		return ClassBlank, false
	default:
		return ClassForeign, system
	}
}

func systemMount(mount string) bool {
	return mount == "/" || mount == "/boot" || mount == "/nix" || mount == "/nix/store"
}

func mountpoints(values []*string) []string {
	result := []string{}
	for _, item := range values {
		if item != nil && *item != "" {
			result = append(result, *item)
		}
	}
	return result
}

func value(item *string) string {
	if item == nil {
		return ""
	}
	return *item
}
