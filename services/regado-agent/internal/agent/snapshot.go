package agent

// Collects host telemetry and dynamically discovered device and mount details
import (
	"context"
	"math"
	"os"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type mount struct {
	Path      string               `json:"path"`
	Source    string               `json:"source"`
	FSType    string               `json:"fsType"`
	Total     int64                `json:"total"`
	Used      int64                `json:"used"`
	Free      int64                `json:"free"`
	Available bool                 `json:"available"`
	Integrity *filesystemIntegrity `json:"integrity"`
}

type swapDevice struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Kind     string `json:"kind"`
	Size     int64  `json:"size"`
	Used     int64  `json:"used"`
	Priority int    `json:"priority"`
}

type service struct {
	ID         string        `json:"id"`
	Active     string        `json:"active"`
	Substate   string        `json:"substate"`
	Loaded     string        `json:"loaded"`
	Type       string        `json:"type,omitempty"`
	Result     string        `json:"result,omitempty"`
	ExitCode   *int          `json:"exitCode,omitempty"`
	FinishedAt *string       `json:"finishedAt,omitempty"`
	Timer      *serviceTimer `json:"timer,omitempty"`
}

type filesystemIntegrity struct {
	UUID            string   `json:"uuid"`
	Members         []string `json:"members"`
	DataProfile     string   `json:"dataProfile"`
	MetadataProfile string   `json:"metadataProfile"`
	SystemProfile   string   `json:"systemProfile"`
	MirroredPercent int      `json:"mirroredPercent"`
	DeviceErrors    int64    `json:"deviceErrors"`
	DevicesOnline   int      `json:"devicesOnline"`
	DevicesExpected int      `json:"devicesExpected"`
	Healthy         bool     `json:"healthy"`
	BalanceRunning  bool     `json:"balanceRunning"`
	ScrubState      string   `json:"scrubState"`
	ScrubErrors     int64    `json:"scrubErrors"`
	PhysicalTotal   int64    `json:"physicalTotal"`
	PhysicalUsed    int64    `json:"physicalUsed"`
}

func snapshot(ctx context.Context, run commandRunner, health *smartMonitor) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	disks, err := readDisks(ctx, run, health)
	if err != nil {
		return nil, err
	}
	readDiskLayouts(ctx, run, disks)
	markSystemDisks(disks)
	mounts := readMounts(ctx, run, disks)
	swaps := readSwapDevices()
	assignPartitionRoles(disks, mounts)
	markStorageStates(disks, mounts, swaps)
	statuses := readServiceStatuses(ctx, run)
	hostname, _ := os.Hostname()

	return map[string]any{
		"hostname":    hostname,
		"host":        readHostInfo(),
		"disks":       disks,
		"mounts":      mounts,
		"swapDevices": swaps,
		"services":    statuses,
		"time":        time.Now().UTC(),
	}, nil
}

func readMounts(ctx context.Context, run commandRunner, disks []disk) []mount {
	byPath := make(map[string]mount)
	integrityBySource := make(map[string]*filesystemIntegrity)
	collectMounts(ctx, run, disks, byPath, integrityBySource)
	result := make([]mount, 0, len(byPath))
	for _, item := range byPath {
		result = append(result, item)
	}
	slices.SortFunc(result, func(left, right mount) int {
		return strings.Compare(left.Path, right.Path)
	})
	return result
}

func collectMounts(
	ctx context.Context,
	run commandRunner,
	disks []disk,
	byPath map[string]mount,
	integrityBySource map[string]*filesystemIntegrity,
) {
	for _, item := range disks {
		for _, mountpoint := range nonEmptyMountpoints(item.Mountpoints) {
			if _, exists := byPath[mountpoint]; !exists {
				byPath[mountpoint] = describeMount(ctx, run, item, mountpoint, integrityBySource)
			}
		}
		collectMounts(ctx, run, item.Children, byPath, integrityBySource)
	}
}

// describeMount reads usage and, once per Btrfs source device, its redundancy profile
func describeMount(ctx context.Context, run commandRunner, item disk, mountpoint string, integrityBySource map[string]*filesystemIntegrity) mount {
	mounted := mount{Path: mountpoint, Source: item.Path, FSType: valueOrEmpty(item.FSType)}
	if usage, err := statMount(mountpoint); err == nil {
		mounted.Total, mounted.Used, mounted.Free, mounted.Available = usage.Total, usage.Used, usage.Free, true
	}
	if mounted.FSType == "btrfs" {
		integrity, checked := integrityBySource[mounted.Source]
		if !checked {
			integrity = readFilesystemIntegrity(ctx, run, mounted.Path)
			integrityBySource[mounted.Source] = integrity
		}
		mounted.Integrity = integrity
	}
	return mounted
}

func readFilesystemIntegrity(ctx context.Context, run commandRunner, path string) *filesystemIntegrity {
	df, err := run(ctx, "btrfs", "filesystem", "df", "-b", path)
	if err != nil {
		return nil
	}
	stats, err := run(ctx, "btrfs", "device", "stats", path)
	if err != nil {
		return nil
	}
	scrub, _ := run(ctx, "btrfs", "scrub", "status", "-d", path)
	devices, _ := run(ctx, "btrfs", "filesystem", "show", "--raw", path)
	online, expected := parseFilesystemDeviceCounts(devices)
	if expected == 0 {
		return nil
	}
	balance, _ := run(ctx, "btrfs", "balance", "status", path)
	item := parseFilesystemIntegrity(df, stats, scrub, devices, balance, online, expected)
	usage, usageErr := run(ctx, "btrfs", "filesystem", "usage", "--raw", path)
	if usageErr == nil {
		item.PhysicalTotal, item.PhysicalUsed = parsePhysicalUsage(usage)
	}
	return &item
}

func readSwapDevices() []swapDevice {
	contents, err := os.ReadFile("/proc/swaps")
	if err != nil {
		return []swapDevice{}
	}
	return parseSwapDevices(string(contents))
}

func parseSwapDevices(raw string) []swapDevice {
	lines := strings.Split(raw, "\n")
	result := make([]swapDevice, 0, max(0, len(lines)-1))
	for _, line := range lines[1:] {
		fields := strings.Fields(line)
		if len(fields) != 5 {
			continue
		}
		sizeKiB, sizeErr := strconv.ParseInt(fields[2], 10, 64)
		usedKiB, usedErr := strconv.ParseInt(fields[3], 10, 64)
		priority, priorityErr := strconv.Atoi(fields[4])
		if sizeErr != nil || usedErr != nil || priorityErr != nil {
			continue
		}
		path := fields[0]
		name := path
		if index := strings.LastIndex(path, "/"); index >= 0 {
			name = path[index+1:]
		}
		kind := "disk swap"
		if strings.HasPrefix(name, "zram") {
			kind = "compressed RAM"
		} else if fields[1] == "file" {
			kind = "swap file"
		}
		result = append(result, swapDevice{Name: name, Path: path, Kind: kind, Size: sizeKiB * 1024, Used: usedKiB * 1024, Priority: priority})
	}
	return result
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func statMount(path string) (mount, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return mount{}, err
	}
	blockSize := int64(stat.Bsize) //nolint:unconvert // Bsize is uint32 on some platforms
	total := blocksToBytes(stat.Blocks, blockSize)
	free := blocksToBytes(stat.Bavail, blockSize)
	used := total - blocksToBytes(stat.Bfree, blockSize)
	return mount{Path: path, Total: total, Used: used, Free: free, Available: true}, nil
}

// blocksToBytes saturates instead of overflowing on implausibly large filesystem reports
func blocksToBytes(blocks uint64, blockSize int64) int64 {
	if blockSize <= 0 || blocks > uint64(math.MaxInt64/blockSize) { //nolint:gosec // positive quotient
		return math.MaxInt64
	}
	return int64(blocks) * blockSize //nolint:gosec // bounded by the check above
}
