package agent

// Discovers partition geometry, roles and usable capacity without treating GPT slack as free volumes
import (
	"context"
	"path/filepath"
	"strconv"
	"strings"
)

const partitionAlignment int64 = 1 << 20

type partitionGeometry struct {
	Number      int
	Start, Size int64
	Flags       string
}

func readDiskLayouts(ctx context.Context, run commandRunner, disks []disk) {
	for index := range disks {
		item := &disks[index]
		raw, err := run(ctx, "parted", "--machine", "--script", item.Path, "unit", "B", "print", "free")
		if err != nil {
			continue
		}
		regions, geometry, available := parseDiskLayout(raw)
		item.LayoutAvailable = available
		item.Unallocated = []diskRegion{}
		for _, region := range regions {
			// GPT headers and alignment gaps cannot hold a useful aligned partition
			if region.Size < partitionAlignment {
				item.OverheadBytes += region.Size
				continue
			}
			start := alignUp(region.Start)
			end := alignDown(region.Start + region.Size)
			if end <= start {
				item.OverheadBytes += region.Size
				continue
			}
			item.Unallocated = append(item.Unallocated, diskRegion{Start: start, Size: end - start})
			item.OverheadBytes += region.Size - (end - start)
		}
		for childIndex := range item.Children {
			child := &item.Children[childIndex]
			number := partitionNumber(item.Path, child.Path)
			for _, part := range geometry {
				if part.Number != number {
					continue
				}
				child.Number, child.Start = number, part.Start
				switch {
				case strings.Contains(part.Flags, "bios_grub"):
					child.BootKind = "BIOS boot"
				case strings.Contains(part.Flags, "esp"):
					child.BootKind = "EFI system"
				}
			}
		}
	}
}

func parseDiskLayout(raw string) (regions []diskRegion, partitions []partitionGeometry, available bool) {
	for line := range strings.SplitSeq(raw, "\n") {
		fields := strings.Split(strings.TrimSuffix(strings.TrimSpace(line), ";"), ":")
		if len(fields) >= 6 && strings.HasPrefix(fields[0], "/dev/") {
			available = true
		}
		if len(fields) < 5 {
			continue
		}
		number, numberErr := strconv.Atoi(fields[0])
		start, startErr := strconv.ParseInt(strings.TrimSuffix(fields[1], "B"), 10, 64)
		size, sizeErr := strconv.ParseInt(strings.TrimSuffix(fields[3], "B"), 10, 64)
		if numberErr != nil || startErr != nil || sizeErr != nil || start < 0 || size <= 0 {
			continue
		}
		if fields[4] == "free" {
			regions = append(regions, diskRegion{Start: start, Size: size})
			continue
		}
		flags := ""
		if len(fields) > 6 {
			flags = fields[6]
		}
		partitions = append(partitions, partitionGeometry{Number: number, Start: start, Size: size, Flags: flags})
	}
	return
}

func parseFreeRegions(raw string) ([]diskRegion, bool) {
	regions, _, available := parseDiskLayout(raw)
	return regions, available
}

func alignUp(value int64) int64 {
	return (value + partitionAlignment - 1) / partitionAlignment * partitionAlignment
}
func alignDown(value int64) int64 { return value / partitionAlignment * partitionAlignment }

func partitionNumber(parent, child string) int {
	suffix := strings.TrimPrefix(strings.TrimPrefix(child, parent), "p")
	number, _ := strconv.Atoi(suffix)
	return number
}

func assignPartitionRoles(disks []disk, mounts []mount) {
	for i := range disks {
		item := &disks[i]
		if item.Type == "part" || (item.Type == "disk" && len(item.Children) == 0 && valueOrEmpty(item.FSType) != "") {
			switch {
			case item.BootKind != "":
				item.Role = "system"
			case hasMountpoint(*item, "/") || valueOrEmpty(item.PartitionLabel) == "kaordo-system":
				item.Role = "system"
			case valueOrEmpty(item.FSType) == "swap":
				item.Role = "system"
			case valueOrEmpty(item.PartitionLabel) == "kaordo-storage" && valueOrEmpty(item.FSType) == "" && len(item.Children) == 0:
				item.Role = "storage"
			default:
				item.Role = "unassigned"
				for _, mounted := range mounts {
					if mounted.Integrity != nil && containsPath(mounted.Integrity.Members, item.Path) {
						item.Role = "storage"
						break
					}
				}
			}
		}
		assignPartitionRoles(item.Children, mounts)
	}
}

func containsPath(paths []string, path string) bool {
	for _, candidate := range paths {
		if filepath.Clean(candidate) == path {
			return true
		}
	}
	return false
}

func parsePhysicalUsage(raw string) (total, used int64) {
	for line := range strings.SplitSeq(raw, "\n") {
		name, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			continue
		}
		parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
		if err != nil {
			continue
		}
		switch name {
		case "Device size":
			total = parsed
		case "Used":
			used = parsed
		}
	}
	return
}

func parseOSRelease(raw string) (name, version string) {
	for line := range strings.SplitSeq(raw, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		if unquoted, err := strconv.Unquote(value); err == nil {
			value = unquoted
		}
		switch key {
		case "NAME":
			name = value
		case "VERSION_ID":
			version = value
		}
	}
	return
}
