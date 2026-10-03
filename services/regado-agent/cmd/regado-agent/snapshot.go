package main

// Collects host, disk, mount, mirror, and service telemetry
import (
	"context"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type disk struct {
	Name        string       `json:"name"`
	Path        string       `json:"path"`
	Label       *string      `json:"label"`
	FSType      *string      `json:"fsType"`
	Size        int64        `json:"size"`
	Type        string       `json:"type"`
	Model       *string      `json:"model"`
	Mountpoints []*string    `json:"mountpoints"`
	Children    []disk       `json:"children,omitempty"`
	Health      *smartHealth `json:"health,omitempty"`
}

type mount struct {
	Path  string `json:"path"`
	Total int64  `json:"total"`
	Used  int64  `json:"used"`
	Free  int64  `json:"free"`
}

type service struct {
	ID       string `json:"id"`
	Active   string `json:"active"`
	Substate string `json:"substate"`
	Loaded   string `json:"loaded"`
}

type mirror struct {
	DataProfile     string `json:"dataProfile"`
	MetadataProfile string `json:"metadataProfile"`
	SystemProfile   string `json:"systemProfile"`
	MirroredPercent int    `json:"mirroredPercent"`
	DeviceErrors    int64  `json:"deviceErrors"`
	DevicesOnline   int    `json:"devicesOnline"`
	Healthy         bool   `json:"healthy"`
	Scrub           string `json:"scrub"`
}

type hostInfo struct {
	CPUModel         string `json:"cpuModel"`
	LogicalCores     int    `json:"logicalCores"`
	MemoryTotalBytes int64  `json:"memoryTotalBytes"`
	UptimeSeconds    int64  `json:"uptimeSeconds"`
	Kernel           string `json:"kernel"`
}

func snapshot(ctx context.Context, run commandRunner, health *smartMonitor) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	disks, err := readDisks(ctx, run, health)
	if err != nil {
		return nil, err
	}

	dataMount, err := statMount(dataRoot)
	if err != nil {
		return nil, err
	}
	rootMount, err := statMount("/")
	if err != nil {
		return nil, err
	}

	storageMirror, err := readMirror(ctx, run, disks)
	if err != nil {
		return nil, err
	}
	statuses := readServiceStatuses(ctx, run)
	hostname, _ := os.Hostname()

	return map[string]any{
		"hostname": hostname,
		"host":     readHostInfo(),
		"disks":    disks,
		"mounts":   []mount{rootMount, dataMount},
		"mirror":   storageMirror,
		"services": statuses,
		"time":     time.Now().UTC(),
	}, nil
}

func readDisks(ctx context.Context, run commandRunner, health *smartMonitor) ([]disk, error) {
	raw, err := run(ctx, "lsblk", "--json", "--bytes", "--output", "NAME,PATH,LABEL,FSTYPE,SIZE,TYPE,MODEL,MOUNTPOINTS")
	if err != nil {
		return nil, err
	}

	var result struct {
		BlockDevices []disk `json:"blockdevices"`
	}
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return nil, err
	}
	attachDiskHealth(ctx, run, health, result.BlockDevices)
	return result.BlockDevices, nil
}

func attachDiskHealth(ctx context.Context, run commandRunner, health *smartMonitor, disks []disk) {
	for index := range disks {
		item := &disks[index]
		if item.Type != "disk" || item.Model == nil || *item.Model == "" || !physicalDevice.MatchString(item.Path) {
			continue
		}

		checked := health.read(ctx, run, item.Path)
		item.Health = &checked
	}
}

func readMirror(ctx context.Context, run commandRunner, disks []disk) (mirror, error) {
	df, err := run(ctx, "btrfs", "filesystem", "df", "-b", dataRoot)
	if err != nil {
		return mirror{}, err
	}
	stats, err := run(ctx, "btrfs", "device", "stats", dataRoot)
	if err != nil {
		return mirror{}, err
	}
	scrub, _ := run(ctx, "btrfs", "scrub", "status", "-d", dataRoot)

	return parseMirror(df, stats, scrub, diskCount(disks)), nil
}

func readServiceStatuses(ctx context.Context, run commandRunner) []service {
	statuses := make([]service, 0, len(services))
	for _, id := range services {
		raw, _ := run(ctx, "systemctl", "show", id+".service", "--property=ActiveState,SubState,LoadState", "--no-pager")
		statuses = append(statuses, parseServiceStatus(id, raw))
	}
	return statuses
}

func parseServiceStatus(id, raw string) service {
	status := service{ID: id}
	for line := range strings.SplitSeq(raw, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch key {
		case "ActiveState":
			status.Active = value
		case "SubState":
			status.Substate = value
		case "LoadState":
			status.Loaded = value
		}
	}
	return status
}

func readHostInfo() hostInfo {
	cpuModel, logicalCores := readCPUInfo()
	return hostInfo{
		CPUModel:         cpuModel,
		LogicalCores:     logicalCores,
		MemoryTotalBytes: readMemoryTotalBytes(),
		UptimeSeconds:    readUptimeSeconds(),
		Kernel:           readKernelVersion(),
	}
}

func readCPUInfo() (string, int) {
	raw, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return "", 0
	}

	var model string
	logicalCores := 0
	for line := range strings.SplitSeq(string(raw), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "model name":
			if model == "" {
				model = strings.TrimSpace(value)
			}
		case "processor":
			logicalCores++
		}
	}
	return model, logicalCores
}

func readMemoryTotalBytes() int64 {
	raw, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}

	for line := range strings.SplitSeq(string(raw), "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0
		}
		kib, _ := strconv.ParseInt(fields[1], 10, 64)
		return kib * 1024
	}
	return 0
}

func readUptimeSeconds() int64 {
	raw, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(raw))
	if len(fields) == 0 {
		return 0
	}
	seconds, _ := strconv.ParseFloat(fields[0], 64)
	return int64(seconds)
}

func readKernelVersion() string {
	raw, err := os.ReadFile("/proc/sys/kernel/osrelease")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

func diskCount(items []disk) int {
	count := 0
	for _, item := range items {
		if item.Type == "part" && item.Label != nil && *item.Label == "Data1" {
			count++
		}
		count += diskCount(item.Children)
	}
	return count
}

func statMount(path string) (mount, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return mount{}, err
	}
	total := int64(stat.Blocks) * int64(stat.Bsize)
	free := int64(stat.Bavail) * int64(stat.Bsize)
	used := total - int64(stat.Bfree)*int64(stat.Bsize)
	return mount{Path: path, Total: total, Used: used, Free: free}, nil
}
