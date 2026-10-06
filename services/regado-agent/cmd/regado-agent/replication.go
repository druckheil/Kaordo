package main

// Runs background Btrfs copy checks and repairs while retaining aggregate file evidence
import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"
)

type replicationReport struct {
	Path          string             `json:"path"`
	State         string             `json:"state"`
	Stage         string             `json:"stage"`
	StartedAt     *time.Time         `json:"startedAt"`
	CheckedAt     *time.Time         `json:"checkedAt"`
	Files         int64              `json:"files"`
	Bytes         int64              `json:"bytes"`
	Unreadable    int64              `json:"unreadable"`
	Duplication   string             `json:"duplication"`
	ChecksumState string             `json:"checksumState"`
	Error         string             `json:"error"`
	Progress      *operationProgress `json:"progress"`
}

type replicationMonitor struct {
	ctx     context.Context
	cancel  context.CancelFunc
	workers sync.WaitGroup
	mu      sync.Mutex
	reports map[string]replicationReport
	layouts map[string]layoutReport
	running bool
	closed  bool
}

func newReplicationMonitor() *replicationMonitor {
	ctx, cancel := context.WithCancel(context.Background())
	return &replicationMonitor{ctx: ctx, cancel: cancel, reports: make(map[string]replicationReport), layouts: make(map[string]layoutReport)}
}

func (monitor *replicationMonitor) Close() {
	monitor.mu.Lock()
	monitor.closed = true
	monitor.cancel()
	monitor.mu.Unlock()
	monitor.workers.Wait()
}

func (monitor *replicationMonitor) status() []replicationReport {
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	result := make([]replicationReport, 0, len(monitor.reports))
	for _, report := range monitor.reports {
		result = append(result, report)
	}
	slices.SortFunc(result, func(a, b replicationReport) int { return strings.Compare(a.Path, b.Path) })
	return result
}

func validateDataPool(ctx context.Context, run commandRunner, path string) error {
	if path == "/" || len(path) > 1024 || !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return errors.New("a mounted data-pool path is required")
	}
	raw, err := run(ctx, "findmnt", "--json", "--list", "--output", "TARGET,FSTYPE")
	if err != nil {
		return err
	}
	if !isMountedBtrfs(raw, path) {
		return errors.New("target is not a mounted Btrfs data pool")
	}
	return nil
}

func (monitor *replicationMonitor) start(ctx context.Context, run commandRunner, path string, repair bool) error {
	if err := validateDataPool(ctx, run, path); err != nil {
		return err
	}
	if repair {
		if _, err := repairPreflight(ctx, run, path); err != nil {
			return err
		}
	}
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	if monitor.closed || monitor.running {
		return errors.New("a storage operation is already running or the agent is stopping")
	}
	now := time.Now().UTC()
	report := replicationReport{Path: path, State: "checking", Stage: "checksums", StartedAt: &now}
	if repair {
		report.State, report.Stage = "repairing", "replication"
	}
	monitor.reports[path], monitor.running = report, true
	monitor.workers.Add(1)
	go monitor.execute(run, path, repair)
	return nil
}

func (monitor *replicationMonitor) execute(run commandRunner, path string, repair bool) {
	defer monitor.workers.Done()
	ctx, cancel := context.WithTimeout(monitor.ctx, 24*time.Hour)
	defer cancel()
	storageMutationMu.Lock()
	defer storageMutationMu.Unlock()
	err := monitor.check(ctx, run, path, repair)
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	report := monitor.reports[path]
	if err != nil {
		report.State, report.Error = "failed", err.Error()
	} else {
		report.State, report.Stage = "complete", "complete"
		total := report.Files
		report.Progress = &operationProgress{Completed: total, Total: &total, Unit: "files"}
	}
	monitor.reports[path], monitor.running = report, false
}

func (monitor *replicationMonitor) check(ctx context.Context, run commandRunner, path string, repair bool) error {
	if err := validateDataPool(ctx, run, path); err != nil {
		return err
	}
	if repair {
		// Revalidate after acquiring the shared mutation lock; disk membership can change while waiting.
		pool, err := repairPreflight(ctx, run, path)
		if err != nil {
			return err
		}
		args := repairConversionArgs(pool, path)
		if len(args) > 0 {
			if _, err := monitor.runMeasured(ctx, run, path, "replication", args); err != nil {
				return errors.New("could not restore two-copy allocation; existing data was retained")
			}
		}
	}
	monitor.setStage(path, "checksums")
	args := []string{"btrfs", "scrub", "start", "-B", "--limit", "64m"}
	if !repair {
		args = append(args, "-r")
	}
	_, scrubErr := monitor.runMeasured(ctx, run, path, "checksums", append(args, path))
	if ctx.Err() != nil {
		return errors.New("storage operation was interrupted; run the check again")
	}
	pool := readFilesystemIntegrity(ctx, run, path)
	if pool == nil {
		return errors.New("could not read the pool state after the checksum check")
	}
	disks, diskErr := readDisks(ctx, run, nil)
	state := duplicationState(pool, diskErr == nil && poolHasDistinctDisks(pool, disks))
	monitor.setStage(path, "inventory")
	files, bytes, unreadable, err := countPoolFilesMeasured(ctx, path, func(files int64) {
		monitor.setProgress(path, &operationProgress{Completed: files, Unit: "files"})
	})
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	monitor.mu.Lock()
	report := monitor.reports[path]
	report.Files, report.Bytes, report.Unreadable = files, bytes, unreadable
	report.CheckedAt, report.Duplication = &now, state
	report.ChecksumState = "passed"
	if scrubErr != nil || pool.ScrubState != "complete" || pool.ScrubErrors > 0 {
		report.ChecksumState = "errors"
	}
	monitor.reports[path] = report
	monitor.mu.Unlock()
	if report.ChecksumState != "passed" {
		return errors.New("checksum scan needs attention; repair requires another valid copy")
	}
	return nil
}

func (monitor *replicationMonitor) setStage(path, stage string) {
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	report := monitor.reports[path]
	report.Stage, report.Progress = stage, nil
	monitor.reports[path] = report
}

func duplicationState(pool *filesystemIntegrity, distinctDisks bool) string {
	if pool == nil || pool.BalanceRunning {
		return "unverified"
	}
	if pool.DataProfile == "single" || pool.DataProfile == "DUP" {
		return "single"
	}
	if pool.DataProfile == "RAID1" && pool.DevicesExpected == 2 && pool.DevicesOnline == 1 {
		return "single"
	}
	if !distinctDisks {
		return "unverified"
	}
	if profileMeetsMirrorPolicy(pool.DataProfile) && profileMeetsMirrorPolicy(pool.MetadataProfile) && profileMeetsMirrorPolicy(pool.SystemProfile) {
		if pool.DevicesOnline == pool.DevicesExpected && pool.DevicesOnline >= 2 {
			return "duplicated"
		}
	}
	return "unverified"
}

func repairPreflight(ctx context.Context, run commandRunner, path string) (*filesystemIntegrity, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	pool := readFilesystemIntegrity(ctx, run, path)
	if pool == nil || pool.DevicesOnline < 2 || pool.DevicesOnline != pool.DevicesExpected || pool.BalanceRunning || pool.ScrubState == "running" {
		return nil, errors.New("repair requires all pool disks online and no running storage operation")
	}
	disks, err := readDisks(ctx, run, nil)
	if err != nil || !poolHasDistinctDisks(pool, disks) {
		return nil, errors.New("repair requires pool members on separate physical disks")
	}
	return pool, nil
}

func repairConversionArgs(pool *filesystemIntegrity, path string) []string {
	// Preserve existing RAID1C3, RAID1C4, and RAID10 placement rather than reducing their redundancy.
	const filters = "profiles=single|dup|raid0|raid5|raid6,convert=raid1,soft"
	args := []string{"btrfs", "balance", "start"}
	if !profileMeetsMirrorPolicy(pool.DataProfile) {
		args = append(args, "-d"+filters)
	}
	if !profileMeetsMirrorPolicy(pool.MetadataProfile) {
		args = append(args, "-m"+filters)
	}
	if !profileMeetsMirrorPolicy(pool.SystemProfile) {
		args = append(args, "-s"+filters, "-f")
	}
	if len(args) == 3 {
		return nil
	}
	return append(args, path)
}

func poolHasDistinctDisks(pool *filesystemIntegrity, disks []disk) bool {
	parents := make(map[string]bool)
	for _, member := range pool.Members {
		for _, physical := range disks {
			if diskContainsPath(physical, member) {
				parents[physical.Path] = true
			}
		}
	}
	return len(parents) == len(pool.Members) && len(parents) >= 2
}

func diskContainsPath(item disk, path string) bool {
	if item.Path == path {
		return true
	}
	for _, child := range item.Children {
		if diskContainsPath(child, path) {
			return true
		}
	}
	return false
}

func countPoolFiles(ctx context.Context, path string) (files, bytes, unreadable int64, err error) {
	return countPoolFilesMeasured(ctx, path, nil)
}

func countPoolFilesMeasured(ctx context.Context, path string, progress func(int64)) (files, bytes, unreadable int64, err error) {
	root, err := os.Stat(path)
	if err != nil {
		return 0, 0, 0, err
	}
	rootDevice := root.Sys().(*syscall.Stat_t).Dev
	err = filepath.WalkDir(path, func(current string, entry fs.DirEntry, walkErr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if walkErr != nil {
			unreadable++
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			unreadable++
			return nil
		}
		if info.Sys().(*syscall.Stat_t).Dev != rootDevice {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if info.Mode().IsRegular() {
			files++
			bytes += info.Size()
			if progress != nil && files%64 == 0 {
				progress(files)
			}
		}
		return nil
	})
	return
}
