// Package integrity verifies the pool's copies and the devices' own self-tests as operations.
package integrity

// Runs a measured, cancellable Btrfs scrub and SMART self-tests and reports what they found
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
)

const (
	KindScrub      = "integrity.scrub"
	KindSMARTShort = "integrity.smart-short"
	KindSMARTLong  = "integrity.smart-long"
)

// ErrUncorrectable means scrub found blocks without a good copy left to repair them from.
var ErrUncorrectable = errors.New("scrub found damaged data that no copy could repair")

// Checker runs integrity work against one host's pool and devices.
type Checker struct {
	Run   command.Runner
	Mount string
	Poll  time.Duration
	// ScrubLimit caps scrub throughput per device, such as "64m", so services stay responsive.
	ScrubLimit string
}

// ScrubResult totals the scrub's error counters across devices.
type ScrubResult struct {
	Corrected     int64
	Uncorrectable int64
}

var (
	scrubTotal    = regexp.MustCompile(`(?m)^Total to scrub:\s+(\d+)`)
	scrubDone     = regexp.MustCompile(`(?m)^Bytes scrubbed:\s+(\d+)`)
	scrubCounters = regexp.MustCompile(`(?m)^\s*(corrected_errors|uncorrectable_errors):\s*(\d+)`)
)

// Scrub reads every copy, repairs bad copies from good ones and fails when one cannot be repaired.
func (checker Checker) Scrub(ctx context.Context, job *operation.Job) error {
	job.Stage(0)
	args := []string{"btrfs", "scrub", "start", "-B"}
	if checker.ScrubLimit != "" {
		args = append(args, "--limit", checker.ScrubLimit)
	}
	err := command.Track(ctx, checker.Run, append(args, checker.Mount), checker.Poll,
		func() { checker.scrubProgress(ctx, job, false) },
		func() { _, _ = checker.Run(context.WithoutCancel(ctx), "btrfs", "scrub", "cancel", checker.Mount) })
	if ctx.Err() != nil {
		return ctx.Err()
	}
	checker.scrubProgress(ctx, job, true)
	// scrub exits non-zero when it found errors; the counters say whether they were repaired
	raw, statusErr := checker.Run(context.WithoutCancel(ctx), "btrfs", "scrub", "status", "-R", checker.Mount)
	if statusErr != nil {
		return errors.Join(err, statusErr)
	}
	result := ParseScrubCounters(raw)
	if result.Corrected > 0 {
		job.Logf("Repaired %d damaged blocks from their good copies", result.Corrected)
	}
	if result.Uncorrectable > 0 {
		return fmt.Errorf("%w: %d blocks", ErrUncorrectable, result.Uncorrectable)
	}
	if err != nil && result.Corrected == 0 {
		return err
	}
	job.Logf("Scrub completed without uncorrectable errors")
	return nil
}

// scrubProgress reports bytes verified; a finished scrub no longer prints them, only its total
func (checker Checker) scrubProgress(ctx context.Context, job *operation.Job, finished bool) {
	status, _ := checker.Run(context.WithoutCancel(ctx), "btrfs", "scrub", "status", "--raw", checker.Mount)
	total, done := firstInt(scrubTotal, status), firstInt(scrubDone, status)
	if finished {
		done = total
	}
	if total > 0 {
		job.Progress(done, total, "bytes")
	}
}

func ParseScrubCounters(raw string) ScrubResult {
	var result ScrubResult
	for _, match := range scrubCounters.FindAllStringSubmatch(raw, -1) {
		value, _ := strconv.ParseInt(match[2], 10, 64)
		if match[1] == "corrected_errors" {
			result.Corrected += value
		} else {
			result.Uncorrectable += value
		}
	}
	return result
}

func firstInt(pattern *regexp.Regexp, text string) int64 {
	match := pattern.FindStringSubmatch(text)
	if match == nil {
		return 0
	}
	value, _ := strconv.ParseInt(match[1], 10, 64)
	return value
}

// selfTestReport is what smartctl reports about self-tests on ATA and NVMe devices
type selfTestReport struct {
	ATA struct {
		SelfTest struct {
			Status struct {
				Value            int  `json:"value"`
				RemainingPercent *int `json:"remaining_percent"`
			} `json:"status"`
		} `json:"self_test"`
	} `json:"ata_smart_data"`
	ATALog struct {
		Standard struct {
			Table []struct {
				Status struct {
					Passed bool   `json:"passed"`
					String string `json:"string"`
				} `json:"status"`
			} `json:"table"`
		} `json:"standard"`
	} `json:"ata_smart_self_test_log"`
	NVMeLog struct {
		Current struct {
			Value int `json:"value"`
		} `json:"current_self_test_operation"`
		Completion *int `json:"current_self_test_completion_percent"`
		Table      []struct {
			Result struct {
				Value  int    `json:"value"`
				String string `json:"string"`
			} `json:"self_test_result"`
		} `json:"table"`
	} `json:"nvme_self_test_log"`
}

// selfTestProgress reports whether a test is still running and how much of it is done
func selfTestProgress(raw string) (running bool, percent int64) {
	var report selfTestReport
	if json.Unmarshal([]byte(raw), &report) != nil {
		return false, 0
	}
	if remaining := report.ATA.SelfTest.Status.RemainingPercent; report.ATA.SelfTest.Status.Value>>4 == 0xf && remaining != nil {
		return true, int64(100 - *remaining)
	}
	if report.NVMeLog.Current.Value != 0 {
		done := int64(0)
		if report.NVMeLog.Completion != nil {
			done = int64(*report.NVMeLog.Completion)
		}
		return true, done
	}
	return false, 100
}

// selfTestVerdict reads the newest self-test log entry
func selfTestVerdict(raw string) error {
	var report selfTestReport
	if json.Unmarshal([]byte(raw), &report) != nil {
		return errors.New("the self-test log could not be read")
	}
	if table := report.ATALog.Standard.Table; len(table) > 0 {
		if !table[0].Status.Passed {
			return errors.New(table[0].Status.String)
		}
		return nil
	}
	if table := report.NVMeLog.Table; len(table) > 0 {
		if table[0].Result.Value != 0 {
			return errors.New(table[0].Result.String)
		}
		return nil
	}
	return errors.New("the device reported no self-test result")
}

// SelfTest runs a short or long SMART self-test on each device in turn; the drive does the work.
func (checker Checker) SelfTest(ctx context.Context, job *operation.Job, kind string, devices []host.Device) error {
	test := "short"
	if kind == KindSMARTLong {
		test = "long"
	}
	var failed []string
	for index, device := range devices {
		job.Stage(index)
		if err := checker.selfTest(ctx, job, test, device); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			job.Logf("%s: %v", device.ID, err)
			failed = append(failed, device.Serial)
			continue
		}
		job.Logf("%s passed the %s self-test", device.ID, test)
	}
	if len(failed) > 0 {
		return fmt.Errorf("the %s self-test failed on %s", test, strings.Join(failed, ", "))
	}
	return nil
}

func (checker Checker) selfTest(ctx context.Context, job *operation.Job, test string, device host.Device) error {
	if _, err := checker.smartctl(ctx, "--test="+test, device.Path); err != nil {
		return err
	}
	ticker := time.NewTicker(checker.Poll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			// Aborting is safe: the drive only stops reading itself
			_, _ = checker.smartctl(context.WithoutCancel(ctx), "--abort", device.Path)
			return ctx.Err()
		case <-ticker.C:
		}
		raw, err := checker.smartctl(ctx, "--capabilities", "--log=selftest", device.Path)
		if err != nil {
			return err
		}
		running, percent := selfTestProgress(raw)
		job.Progress(percent, 100, "percent")
		if !running {
			return selfTestVerdict(raw)
		}
	}
}

// smartctl's exit code is a bitmask; only its low bits mean the command itself failed
func (checker Checker) smartctl(ctx context.Context, args ...string) (string, error) {
	raw, err := checker.Run(ctx, append([]string{"smartctl", "--json"}, args...)...)
	if err == nil {
		return raw, nil
	}
	var report struct {
		Smartctl struct {
			ExitStatus int `json:"exit_status"`
		} `json:"smartctl"`
	}
	if json.Unmarshal([]byte(raw), &report) == nil && report.Smartctl.ExitStatus&0b111 == 0 {
		return raw, nil
	}
	return raw, err
}
