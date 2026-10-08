package agent

// Discovers physical devices and annotates their identity, health and storage eligibility
import (
	"context"
	"encoding/json"
	"strings"
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
