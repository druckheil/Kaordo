package main

// Collects host telemetry and dynamically discovered device and mount details
import (
	"context"
	"encoding/json"
	"os"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type disk struct {
	Name              string       `json:"name"`
	Path              string       `json:"path"`
	Label             *string      `json:"label"`
	PartitionLabel    *string      `json:"partitionLabel"`
	FSType            *string      `json:"fsType"`
	Size              int64        `json:"size"`
	Type              string       `json:"type"`
	Model             *string      `json:"model"`
	Serial            *string      `json:"serial"`
	WWN               *string      `json:"wwn"`
	Mountpoints       []*string    `json:"mountpoints"`
	SystemDisk        bool         `json:"systemDisk"`
	StorageState      string       `json:"storageState"`
	ConfigureEligible bool         `json:"configureEligible"`
	ConfigureReason   string       `json:"configureReason"`
	Children          []disk       `json:"children,omitempty"`
	Health            *smartHealth `json:"health,omitempty"`
	Unallocated       []diskRegion `json:"unallocated,omitempty"`
	LayoutAvailable   bool         `json:"layoutAvailable"`
	Transport         *string      `json:"transport"`
	Address           *string      `json:"address"`
	PartitionType     *string      `json:"partitionType"`
	Start             int64        `json:"start"`
	Number            int          `json:"number"`
	Role              string       `json:"role"`
	BootKind          string       `json:"bootKind"`
	OverheadBytes     int64        `json:"overheadBytes"`
}

type diskRegion struct {
	Start int64 `json:"start"`
	Size  int64 `json:"size"`
}

func (item *disk) UnmarshalJSON(raw []byte) error {
	type diskAlias disk
	decoded := struct {
		*diskAlias
		PartitionLabel *string `json:"partlabel"`
		PartitionType  *string `json:"parttype"`
		Transport      *string `json:"tran"`
		Address        *string `json:"hctl"`
	}{diskAlias: (*diskAlias)(item)}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return err
	}
	if decoded.PartitionLabel != nil {
		item.PartitionLabel = decoded.PartitionLabel
	}
	if decoded.PartitionType != nil {
		item.PartitionType = decoded.PartitionType
	}
	if decoded.Transport != nil {
		item.Transport = decoded.Transport
	}
	if decoded.Address != nil {
		item.Address = decoded.Address
	}
	return nil
}

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

type hostInfo struct {
	CPUModel         string `json:"cpuModel"`
	LogicalCores     int    `json:"logicalCores"`
	MemoryTotalBytes int64  `json:"memoryTotalBytes"`
	UptimeSeconds    int64  `json:"uptimeSeconds"`
	Kernel           string `json:"kernel"`
	OSName           string `json:"osName"`
	OSVersion        string `json:"osVersion"`
	BootMode         string `json:"bootMode"`
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

func readDisks(ctx context.Context, run commandRunner, health *smartMonitor) ([]disk, error) {
	raw, err := run(ctx, "lsblk", "--json", "--bytes", "--output", "NAME,PATH,LABEL,PARTLABEL,PARTTYPE,FSTYPE,SIZE,TYPE,MODEL,SERIAL,WWN,TRAN,HCTL,MOUNTPOINTS")
	if err != nil {
		return nil, err
	}

	var result struct {
		BlockDevices []disk `json:"blockdevices"`
	}
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return nil, err
	}
	physical := make([]disk, 0, len(result.BlockDevices))
	for _, item := range result.BlockDevices {
		if item.Type == "disk" && physicalDevice.MatchString(item.Path) {
			physical = append(physical, item)
		}
	}
	normalizeMountpoints(physical)
	attachDiskHealth(run, health, physical)
	return physical, nil
}

func normalizeMountpoints(disks []disk) {
	for index := range disks {
		if disks[index].Mountpoints == nil {
			disks[index].Mountpoints = []*string{}
		}
		normalizeMountpoints(disks[index].Children)
	}
}

func attachDiskHealth(run commandRunner, health *smartMonitor, disks []disk) {
	if health == nil {
		return
	}
	for index := range disks {
		item := &disks[index]
		if item.Type != "disk" || !physicalDevice.MatchString(item.Path) {
			continue
		}

		if checked, available := health.read(run, item.Path); available {
			item.Health = &checked
		}
	}
}

func markSystemDisks(disks []disk) {
	for index := range disks {
		markSystemDevice(&disks[index])
	}
}

func markSystemDevice(item *disk) {
	item.SystemDisk = item.Type == "disk" && hasMountpoint(*item, "/")
	for index := range item.Children {
		markSystemDevice(&item.Children[index])
	}
}

func hasMountpoint(item disk, path string) bool {
	for _, mountpoint := range item.Mountpoints {
		if mountpoint != nil && *mountpoint == path {
			return true
		}
	}
	for _, child := range item.Children {
		if hasMountpoint(child, path) {
			return true
		}
	}
	return false
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
		for _, mountpoint := range item.Mountpoints {
			if mountpoint == nil || *mountpoint == "" {
				continue
			}
			if _, exists := byPath[*mountpoint]; exists {
				continue
			}
			mounted := mount{Path: *mountpoint, Source: item.Path, FSType: valueOrEmpty(item.FSType)}
			if usage, err := statMount(*mountpoint); err == nil {
				mounted.Total = usage.Total
				mounted.Used = usage.Used
				mounted.Free = usage.Free
				mounted.Available = true
			}
			if mounted.FSType == "btrfs" {
				integrity, checked := integrityBySource[mounted.Source]
				if !checked {
					integrity = readFilesystemIntegrity(ctx, run, mounted.Path)
					integrityBySource[mounted.Source] = integrity
				}
				mounted.Integrity = integrity
			}
			byPath[*mountpoint] = mounted
		}
		collectMounts(ctx, run, item.Children, byPath, integrityBySource)
	}
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

func markStorageStates(disks []disk, mounts []mount, swaps []swapDevice) {
	memberStates := make(map[string]string)
	for _, mounted := range mounts {
		if mounted.Integrity == nil {
			continue
		}
		state := "working"
		if mounted.Integrity.BalanceRunning && !mounted.Integrity.Healthy {
			state = "queued"
		}
		for _, path := range mounted.Integrity.Members {
			memberStates[path] = state
		}
	}
	for index := range disks {
		markDiskStorageState(&disks[index], memberStates, swaps)
	}
}

func markDiskStorageState(item *disk, memberStates map[string]string, swaps []swapDevice) {
	if item.Type == "disk" {
		item.StorageState = "unconfigured"
		item.ConfigureEligible, item.ConfigureReason = diskConfigureEligibility(*item, swaps)
		if item.SystemDisk {
			item.StorageState = "working"
			item.ConfigureEligible = false
			item.ConfigureReason = "System disk"
		} else if storageSetupInProgress(item.Path) {
			item.StorageState = "queued"
			item.ConfigureEligible = false
			item.ConfigureReason = "Disk setup is in progress"
		} else if state, exists := memberStatesForDisk(*item, memberStates); exists {
			item.StorageState = state
			item.ConfigureEligible = false
			item.ConfigureReason = "Already belongs to a mounted Btrfs pool"
		} else {
			for _, part := range item.Children {
				if valueOrEmpty(part.PartitionLabel) == "kaordo-system" && len(nonEmptyMountpoints(part.Mountpoints)) > 0 {
					item.StorageState = "working"
				}
				if partitionNeedsActivation(part) {
					item.StorageState = "queued"
					item.ConfigureReason = "Review prepared volumes in Manage partitions"
					break
				}
			}
		}
	}
	for index := range item.Children {
		markDiskStorageState(&item.Children[index], memberStates, swaps)
	}
}

func memberStatesForDisk(item disk, memberStates map[string]string) (string, bool) {
	if state, exists := memberStates[item.Path]; exists {
		return state, true
	}
	for _, child := range item.Children {
		if state, exists := memberStatesForDisk(child, memberStates); exists {
			return state, true
		}
	}
	return "", false
}

func diskConfigureEligibility(item disk, swaps []swapDevice) (bool, string) {
	if !physicalDevice.MatchString(item.Path) {
		return false, "Not a supported physical device"
	}
	if len(item.Children) > 0 || valueOrEmpty(item.FSType) != "" || len(nonEmptyMountpoints(item.Mountpoints)) > 0 {
		return false, "Device already has partitions or a filesystem"
	}
	if diskIsSwap(item, swaps) {
		return false, "Device is currently used for swap"
	}
	if deviceIdentity(item) == "" {
		return false, "A stable hardware identity is unavailable"
	}
	return true, "Ready to join a storage pool"
}

func diskIsSwap(item disk, swaps []swapDevice) bool {
	for _, swap := range swaps {
		if item.Path == swap.Path {
			return true
		}
	}
	for _, child := range item.Children {
		if diskIsSwap(child, swaps) {
			return true
		}
	}
	return false
}

func nonEmptyMountpoints(mountpoints []*string) []string {
	result := make([]string, 0, len(mountpoints))
	for _, path := range mountpoints {
		if path != nil && *path != "" {
			result = append(result, *path)
		}
	}
	return result
}

func deviceIdentity(item disk) string {
	if value := strings.TrimSpace(valueOrEmpty(item.WWN)); value != "" {
		return "wwn:" + value
	}
	if value := strings.TrimSpace(valueOrEmpty(item.Serial)); value != "" {
		return "serial:" + value
	}
	return ""
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

func readHostInfo() hostInfo {
	cpuModel, logicalCores := readCPUInfo()
	osRelease, _ := os.ReadFile("/etc/os-release")
	osName, osVersion := parseOSRelease(string(osRelease))
	return hostInfo{
		CPUModel:         cpuModel,
		LogicalCores:     logicalCores,
		MemoryTotalBytes: readMemoryTotalBytes(),
		UptimeSeconds:    readUptimeSeconds(),
		Kernel:           readKernelVersion(),
		OSName:           osName,
		OSVersion:        osVersion,
		BootMode:         hostBootMode(),
	}
}

func hostBootMode() string {
	if _, err := os.Stat("/sys/firmware/efi"); err == nil {
		return "uefi"
	}
	return "bios"
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

func statMount(path string) (mount, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return mount{}, err
	}
	total := int64(stat.Blocks) * int64(stat.Bsize)
	free := int64(stat.Bavail) * int64(stat.Bsize)
	used := total - int64(stat.Bfree)*int64(stat.Bsize)
	return mount{Path: path, Total: total, Used: used, Free: free, Available: true}, nil
}
