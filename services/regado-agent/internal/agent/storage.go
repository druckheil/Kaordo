package agent

// Validates and onboards an empty physical disk into a mounted Btrfs pool
import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
)

var storageMutationMu sync.Mutex
var storageSetupProgress = struct {
	sync.RWMutex
	devices map[string]struct{}
}{devices: make(map[string]struct{})}

type storageActionRequest struct {
	Target     string `json:"target"`
	Identity   string `json:"identity"`
	Filesystem string `json:"filesystem"`
}

func legacyStorageLayout(ctx context.Context, run commandRunner, request storageActionRequest) (layoutRequest, error) {
	if !validStorageTarget(request.Target) || !validMountPath(request.Filesystem) || request.Filesystem == "/" || request.Identity == "" {
		return layoutRequest{}, errors.New("invalid Storage target")
	}
	disks, err := readDisks(ctx, run, nil)
	if err != nil {
		return layoutRequest{}, err
	}
	markSystemDisks(disks)
	device, found := findPhysicalDisk(disks, request.Target)
	if !found || deviceIdentity(device) != request.Identity || device.SystemDisk {
		return layoutRequest{}, errors.New("device identity changed or a System volume was selected")
	}
	if eligible, reason := diskConfigureEligibility(device, readSwapDevices()); !eligible || len(device.Children) > 0 {
		return layoutRequest{}, fmt.Errorf("use Manage partitions to review existing volumes: %s", reason)
	}
	return layoutRequest{Device: request.Target, Identity: request.Identity, Filesystem: request.Filesystem, StorageBytes: alignDown(device.Size - 2*partitionAlignment)}, nil
}

func profileMeetsMirrorPolicy(profile string) bool {
	switch profile {
	case "RAID1", "RAID1C3", "RAID1C4", "RAID10":
		return true
	default:
		return false
	}
}

func validStorageTarget(path string) bool {
	return filepath.Clean(path) == path && physicalDevice.MatchString(path)
}

func setStorageSetupInProgress(path string, inProgress bool) {
	storageSetupProgress.Lock()
	defer storageSetupProgress.Unlock()
	if inProgress {
		storageSetupProgress.devices[path] = struct{}{}
		return
	}
	delete(storageSetupProgress.devices, path)
}

func storageSetupInProgress(path string) bool {
	storageSetupProgress.RLock()
	defer storageSetupProgress.RUnlock()
	_, exists := storageSetupProgress.devices[path]
	return exists
}

func validMountPath(path string) bool {
	return len(path) <= 1024 && filepath.IsAbs(path) && filepath.Clean(path) == path
}

func findPhysicalDisk(disks []disk, path string) (disk, bool) {
	for _, item := range disks {
		if item.Path == path && item.Type == "disk" && physicalDevice.MatchString(item.Path) {
			return item, true
		}
	}
	return disk{}, false
}
