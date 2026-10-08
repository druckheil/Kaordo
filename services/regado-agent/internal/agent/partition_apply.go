package agent

// Applies revalidated partition plans with filesystem-aware ordering and background operation status
import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

var volumeUUIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type layoutReport struct {
	Device    string             `json:"device"`
	State     string             `json:"state"`
	Stage     string             `json:"stage"`
	StartedAt time.Time          `json:"startedAt"`
	Error     string             `json:"error"`
	Progress  *operationProgress `json:"progress"`
}

func (monitor *replicationMonitor) startLayout(ctx context.Context, run commandRunner, request layoutRequest) error {
	if len(request.Fingerprint) != 64 || request.Confirmation != request.Device {
		return errors.New("confirm the reviewed device and layout")
	}
	plan, err := previewStoragePlan(ctx, run, request)
	if err != nil {
		return err
	}
	if !plan.Supported || plan.Fingerprint != request.Fingerprint {
		return errors.New("the reviewed layout changed or requires offline migration; refresh its preview")
	}
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	if monitor.closed || monitor.running {
		return errors.New("another storage operation is already running")
	}
	monitor.running = true
	monitor.layouts[request.Device] = layoutReport{Device: request.Device, State: "running", Stage: "Validating layout", StartedAt: time.Now().UTC()}
	monitor.workers.Add(1)
	go monitor.applyLayout(run, request)
	return nil
}

func (monitor *replicationMonitor) layoutStatus() []layoutReport {
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	reports := make([]layoutReport, 0, len(monitor.layouts))
	for _, report := range monitor.layouts {
		reports = append(reports, report)
	}
	slices.SortFunc(reports, func(a, b layoutReport) int { return strings.Compare(a.Device, b.Device) })
	return reports
}

func (monitor *replicationMonitor) applyLayout(run commandRunner, request layoutRequest) {
	defer monitor.workers.Done()
	ctx, cancel := context.WithTimeout(monitor.ctx, 24*time.Hour)
	defer cancel()
	storageMutationMu.Lock()
	defer storageMutationMu.Unlock()
	setStorageSetupInProgress(request.Device, true)
	defer setStorageSetupInProgress(request.Device, false)
	err := monitor.executeLayout(ctx, run, request)
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	report := monitor.layouts[request.Device]
	report.State, report.Stage = "complete", "Layout applied"
	if err != nil {
		report.State, report.Error = "failed", err.Error()
		report.Stage = "Needs attention"
	}
	monitor.layouts[request.Device], monitor.running = report, false
}

func (monitor *replicationMonitor) layoutProgress(device, stage string, completed, total int64) {
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	report := monitor.layouts[device]
	report.Stage = stage
	report.Progress = &operationProgress{Completed: completed, Total: &total, Unit: "steps"}
	monitor.layouts[device] = report
}

func (monitor *replicationMonitor) executeLayout(ctx context.Context, run commandRunner, request layoutRequest) error {
	plan, err := previewStoragePlan(ctx, run, request)
	if err != nil {
		return err
	}
	if !plan.Supported || plan.Fingerprint != request.Fingerprint {
		return errors.New("device layout changed; no changes were applied")
	}
	device, _, err := layoutInventory(ctx, run, request)
	if err != nil {
		return err
	}
	if err := layoutPoolPreflight(ctx, run, request, plan, device); err != nil {
		return err
	}
	work, err := monitor.prepareLayoutWorkspace(ctx, run, request, plan, device)
	if err != nil {
		return err
	}
	if err := approveLayoutWorkspace(ctx, run, request, plan, work); err != nil {
		return err
	}
	if err := monitor.applyPartitionDeclaration(ctx, run, request, plan, device, work); err != nil {
		return err
	}
	for _, step := range plan.Steps {
		if step.Kind != "keep" {
			if err := activateRoleArea(ctx, run, request, step); err != nil {
				return err
			}
		}
	}
	monitor.layoutProgress(request.Device, "Volumes available", 2, 3)
	if request.StorageBytes > 0 {
		if err := monitor.restoreLayoutRedundancy(ctx, run, request); err != nil {
			return err
		}
	}
	monitor.layoutProgress(request.Device, "Layout applied", 3, 3)
	return nil
}

func (monitor *replicationMonitor) prepareLayoutWorkspace(ctx context.Context, run commandRunner, request layoutRequest, plan storagePlan, device disk) (string, error) {
	if plan.Backend != "disko" {
		definitions, definitionErr := repartDefinitions(device, plan)
		if definitionErr != nil {
			return "", definitionErr
		}
		return writeLayoutWorkspace(definitions, "")
	}
	signatures, err := run(ctx, "wipefs", "--no-act", "--noheadings", "--output", "TYPE", request.Device)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(signatures) != "" || len(device.Children) != 0 {
		return "", errors.New("Disko initialization accepts only an empty physical device")
	}
	work, err := writeLayoutWorkspace(nil, plan.Declaration)
	if err != nil {
		return "", err
	}
	monitor.layoutProgress(request.Device, "Compiling Disko declaration", 0, 0)
	if _, err := run(ctx, "disko", "--mode", "format", "--dry-run", filepath.Join(work, "disko.nix")); err != nil {
		return "", errors.New("Disko declaration could not be compiled; no partition was changed")
	}
	return work, nil
}

func approveLayoutWorkspace(ctx context.Context, run commandRunner, request layoutRequest, plan storagePlan, work string) error {
	// Retain the approved declaration for operator review; nothing is applied automatically at boot
	if err := os.WriteFile(filepath.Join(work, "approved.json"), mustJSON(request), 0600); err != nil {
		return err
	}
	if err := verifyPhysicalIdentity(ctx, run, request.Device, request.Identity); err != nil {
		return err
	}
	latest, err := previewStoragePlan(ctx, run, request)
	if err != nil || !latest.Supported || latest.Fingerprint != request.Fingerprint {
		return errors.New("the device changed while the declaration was prepared; no partition changes were applied")
	}
	raw, err := run(ctx, "sfdisk", "--dump", request.Device)
	if err != nil && plan.Backend != "disko" {
		return errors.New("could not save the existing partition table; no changes were applied")
	}
	if err == nil {
		if err := os.WriteFile(filepath.Join(work, "partition-table.before"), []byte(raw), 0600); err != nil {
			return err
		}
	}
	return nil
}

func (monitor *replicationMonitor) applyPartitionDeclaration(ctx context.Context, run commandRunner, request layoutRequest, plan storagePlan, device disk, work string) error {
	monitor.layoutProgress(request.Device, "Applying "+plan.Backend+" declaration", 0, 0)
	if plan.Backend == "disko" {
		if _, err := run(ctx, "disko", "--mode", "format", filepath.Join(work, "disko.nix")); err != nil {
			return errors.New("Disko initialization stopped; inspect the device before retrying")
		}
	} else {
		fresh, err := run(ctx, repartArgs(work, request.Device, true)...)
		if err != nil {
			return err
		}
		if _, err := validatedRepartSteps(fresh, device, plan); err != nil {
			return err
		}
		if _, err := run(ctx, repartArgs(work, request.Device, false)...); err != nil {
			return errors.New("systemd-repart stopped; existing files were retained")
		}
	}
	if _, err := run(ctx, "udevadm", "settle", "--timeout=30"); err != nil {
		return err
	}
	monitor.layoutProgress(request.Device, "Partition layout ready", 1, 3)
	return nil
}

func (monitor *replicationMonitor) restoreLayoutRedundancy(ctx context.Context, run commandRunner, request layoutRequest) error {
	pool := readFilesystemIntegrity(ctx, run, request.Filesystem)
	if pool == nil {
		return errors.New("Storage pool status is unavailable")
	}
	args := repairConversionArgs(pool, request.Filesystem)
	if len(args) == 0 {
		return nil
	}
	if _, err := repairPreflight(ctx, run, request.Filesystem); err != nil {
		return err
	}
	monitor.layoutProgress(request.Device, "Restoring two-copy allocation", 0, 0)
	_, err := monitor.runLayoutBalance(ctx, run, request.Device, request.Filesystem, args)
	return err
}

func mustJSON(value any) []byte { raw, _ := json.Marshal(value); return raw }

func layoutPoolPreflight(ctx context.Context, run commandRunner, request layoutRequest, plan storagePlan, device disk) error {
	if request.StorageBytes == 0 {
		return nil
	}
	pool := readFilesystemIntegrity(ctx, run, request.Filesystem)
	if pool == nil || pool.BalanceRunning || pool.ScrubState == "running" {
		return errors.New("Storage pool is unavailable or busy")
	}
	for _, step := range plan.Steps {
		if step.Role != "storage" {
			continue
		}
		if step.Kind == "resize" {
			if !containsPath(pool.Members, step.Source) {
				return errors.New("the selected pool does not own this Storage partition")
			}
			if _, err := repairPreflight(ctx, run, request.Filesystem); err != nil {
				return err
			}
		} else if step.Kind == "create" || step.Kind == "activate" {
			for _, member := range pool.Members {
				if diskContainsPath(device, member) {
					return errors.New("the physical device already participates in this pool")
				}
			}
		}
	}
	return nil
}

func activateRoleArea(ctx context.Context, run commandRunner, request layoutRequest, step layoutStep) error {
	if err := verifyPhysicalIdentity(ctx, run, request.Device, request.Identity); err != nil {
		return err
	}
	disks, err := readDisks(ctx, run, nil)
	if err != nil {
		return err
	}
	device, found := findPhysicalDisk(disks, request.Device)
	if !found {
		return errors.New("device disappeared after partitioning")
	}
	var parts []disk
	for _, part := range device.Children {
		if step.Source != "" && part.Path != step.Source {
			continue
		}
		if step.Source == "" && valueOrEmpty(part.PartitionLabel) != "kaordo-"+step.Role {
			continue
		}
		if part.Size != step.Size {
			return errors.New("partition size does not match the approved declaration")
		}
		parts = append(parts, part)
	}
	if len(parts) != 1 {
		return errors.New("declared area could not be identified uniquely")
	}
	part := parts[0]
	if step.Role == "system" {
		if valueOrEmpty(part.FSType) != "ext4" {
			return errors.New("System filesystem was not prepared")
		}
		return mountSystemVolume(ctx, run, part.Path)
	}
	if step.Kind == "create" || step.Kind == "activate" {
		signatures, err := run(ctx, "wipefs", "--no-act", "--noheadings", "--output", "TYPE", part.Path)
		if err != nil {
			return err
		}
		if strings.TrimSpace(signatures) != "" {
			return errors.New("new Storage area contains existing signatures and was not added")
		}
		_, err = run(ctx, "btrfs", "device", "add", part.Path, request.Filesystem)
		return err
	}
	raw, err := run(ctx, "btrfs", "filesystem", "show", "--raw", request.Filesystem)
	if err != nil {
		return err
	}
	id := btrfsDeviceID(raw, part.Path)
	if id == "" {
		return errors.New("Storage pool member identity changed")
	}
	_, err = run(ctx, "btrfs", "filesystem", "resize", id+":max", request.Filesystem)
	return err
}

func verifyPhysicalIdentity(ctx context.Context, run commandRunner, path, identity string) error {
	disks, err := readDisks(ctx, run, nil)
	if err != nil {
		return err
	}
	device, found := findPhysicalDisk(disks, path)
	if !found || deviceIdentity(device) != identity {
		return errors.New("physical device identity changed")
	}
	return nil
}

func btrfsDeviceID(raw, path string) string {
	for line := range strings.SplitSeq(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 8 && fields[0] == "devid" && fields[len(fields)-2] == "path" && fields[len(fields)-1] == path {
			if id, err := strconv.Atoi(fields[1]); err == nil && id > 0 {
				return fields[1]
			}
		}
	}
	return ""
}

func mountSystemVolume(ctx context.Context, run commandRunner, path string) error {
	uuid, err := run(ctx, "blkid", "--match-tag", "UUID", "--output", "value", path)
	if err != nil {
		return err
	}
	uuid = strings.TrimSpace(uuid)
	if !volumeUUIDPattern.MatchString(uuid) {
		return errors.New("new System volume UUID is invalid")
	}
	_, err = run(ctx, "systemd-mount", "--collect", "--options=nodev,nosuid", path, "/var/lib/kaordo-volumes/"+uuid)
	return err
}

func MountSystemVolumes(ctx context.Context) error {
	run := runCommand
	disks, err := readDisks(ctx, run, nil)
	if err != nil {
		return err
	}
	for _, device := range disks {
		for _, part := range device.Children {
			if valueOrEmpty(part.PartitionLabel) == "kaordo-system" && valueOrEmpty(part.FSType) == "ext4" && len(nonEmptyMountpoints(part.Mountpoints)) == 0 {
				if err := mountSystemVolume(ctx, run, part.Path); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
