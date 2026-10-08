package agent

// Reads measured Btrfs progress while long commands continue independently of HTTP requests
import (
	"context"
	"regexp"
	"strconv"
	"time"
)

type operationProgress struct {
	Completed int64  `json:"completed"`
	Total     *int64 `json:"total"`
	Unit      string `json:"unit"`
}

var scrubProgressValue = regexp.MustCompile(`(?m)^\s*(Total to scrub|Bytes scrubbed):\s+(\d+)`)
var scrubRunning = regexp.MustCompile(`(?m)^\s*Status:\s+running\s*$`)
var balanceProgressValue = regexp.MustCompile(`(?i)(\d+) out of (?:about )?(\d+) chunks`)

func parseScrubProgress(raw string) *operationProgress {
	// History from a previous scan must never appear as progress of a newly started job
	if !scrubRunning.MatchString(raw) {
		return nil
	}
	total, completed := int64(0), int64(0)
	for _, match := range scrubProgressValue.FindAllStringSubmatch(raw, -1) {
		value, err := strconv.ParseInt(match[2], 10, 64)
		if err != nil {
			return nil
		}
		if match[1] == "Total to scrub" {
			total += value
		} else {
			completed += value
		}
	}
	if total <= 0 {
		return nil
	}
	return &operationProgress{Completed: min(completed, total), Total: &total, Unit: "bytes"}
}

func parseBalanceProgress(raw string) *operationProgress {
	match := balanceProgressValue.FindStringSubmatch(raw)
	if len(match) != 3 {
		return nil
	}
	completed, err := strconv.ParseInt(match[1], 10, 64)
	total, totalErr := strconv.ParseInt(match[2], 10, 64)
	if err != nil || totalErr != nil || total <= 0 {
		return nil
	}
	return &operationProgress{Completed: min(completed, total), Total: &total, Unit: "chunks"}
}

func (monitor *replicationMonitor) runMeasured(ctx context.Context, run commandRunner, path, stage string, args []string) (string, error) {
	return runBtrfsMeasured(ctx, run, path, stage, args, func(progress *operationProgress) {
		monitor.mu.Lock()
		defer monitor.mu.Unlock()
		report := monitor.reports[path]
		report.Progress = progress
		monitor.reports[path] = report
	})
}

func (monitor *replicationMonitor) setProgress(path string, progress *operationProgress) {
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	report := monitor.reports[path]
	report.Progress = progress
	monitor.reports[path] = report
}

func (monitor *replicationMonitor) runLayoutBalance(ctx context.Context, run commandRunner, device, path string, args []string) (string, error) {
	return runBtrfsMeasured(ctx, run, path, "replication", args, func(progress *operationProgress) {
		monitor.mu.Lock()
		defer monitor.mu.Unlock()
		report := monitor.layouts[device]
		report.Progress = progress
		monitor.layouts[device] = report
	})
}

func runBtrfsMeasured(ctx context.Context, run commandRunner, path, stage string, args []string, publish func(*operationProgress)) (string, error) {
	pollCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-pollCtx.Done():
				return
			case <-ticker.C:
				probe, stop := context.WithTimeout(pollCtx, 2*time.Second)
				progress := readBtrfsProgress(probe, run, path, stage)
				stop()
				if progress != nil {
					publish(progress)
				}
			}
		}
	}()
	output, err := run(ctx, args...)
	cancel()
	<-done
	return output, err
}

func readBtrfsProgress(ctx context.Context, run commandRunner, path, stage string) *operationProgress {
	if stage == "checksums" {
		raw, err := run(ctx, "btrfs", "scrub", "status", "--raw", path)
		if err == nil {
			return parseScrubProgress(raw)
		}
		return nil
	}
	raw, err := run(ctx, "btrfs", "balance", "status", "-v", path)
	if err == nil {
		return parseBalanceProgress(raw)
	}
	return nil
}
