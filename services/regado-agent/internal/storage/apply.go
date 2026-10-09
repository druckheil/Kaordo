package storage

// Performs pool plan steps with btrfs-progs and sgdisk, reporting measured progress per step
import (
	"context"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
)

// Bootloader installs the host's bootloader on a pool device so any member can boot the host.
type Bootloader interface {
	Install(ctx context.Context, device host.Device) error
}

type Executor struct {
	Run   command.Runner
	Mount string
	// Boot is nil on hosts whose boot layout predates the uniform template.
	Boot Bootloader
	// EFI selects an EFI system partition instead of a BIOS boot partition.
	EFI bool
	// Poll is the interval between progress reads of long-running tools.
	Poll time.Duration
}

var (
	replacePercent = regexp.MustCompile(`([0-9]+(?:\.[0-9]+)?)% done`)
	balanceChunks  = regexp.MustCompile(`(\d+) out of (?:about )?(\d+) chunks`)
	usageDevice    = regexp.MustCompile(`^(\S+), ID: (\d+)`)
	usageUsed      = regexp.MustCompile(`^\s+(Data|Metadata|System),[^:]+:\s+(\d+)`)
)

// Stages names the operation stages for a plan, one per step.
func Stages(plan Plan) []string {
	stages := make([]string, len(plan.Steps))
	for index, step := range plan.Steps {
		stages[index] = step.Summary
	}
	return stages
}

// Apply runs every step in order. Cancellation takes effect at the next safe point:
// balance and replace are cancelled through btrfs, other steps finish first.
func (executor Executor) Apply(ctx context.Context, job *operation.Job, plan Plan, devices []host.Device) error {
	byID := map[string]host.Device{}
	for _, device := range devices {
		byID[device.ID] = device
	}
	for index, step := range plan.Steps {
		if err := ctx.Err(); err != nil {
			return err
		}
		job.Stage(index)
		var err error
		switch step.Kind {
		case StepAdd:
			err = executor.add(ctx, job, byID[step.Device])
		case StepReplace:
			err = executor.replace(ctx, job, byID[step.Device], step.Replaces)
		case StepConvert:
			err = executor.convert(ctx, job, step.Data, step.Metadata)
		case StepRemove:
			err = executor.remove(ctx, job, byID[step.Device], step.Replaces)
		default:
			err = fmt.Errorf("unknown step %q", step.Kind)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (executor Executor) add(ctx context.Context, job *operation.Job, device host.Device) error {
	member, err := executor.prepare(ctx, job, device)
	if err != nil {
		return err
	}
	job.Detail("Adding the device to the pool")
	if _, err := executor.Run(context.WithoutCancel(ctx), "btrfs", "device", "add", member, executor.Mount); err != nil {
		return err
	}
	job.Logf("Added %s as %s", device.ID, member)
	return executor.installBoot(ctx, job, device)
}

func (executor Executor) replace(ctx context.Context, job *operation.Job, device host.Device, devid int64) error {
	member, err := executor.prepare(ctx, job, device)
	if err != nil {
		return err
	}
	source := strconv.FormatInt(devid, 10)
	job.Detail("Copying data onto the replacement")
	err = executor.tracked(ctx, []string{"btrfs", "replace", "start", "-B", source, member, executor.Mount},
		func() {
			status, _ := executor.Run(context.WithoutCancel(ctx), "btrfs", "replace", "status", "-1", executor.Mount)
			if match := replacePercent.FindStringSubmatch(status); match != nil {
				percent, _ := strconv.ParseFloat(match[1], 64)
				job.Progress(int64(percent*10), 1000, "permille")
			}
		},
		func() { _, _ = executor.Run(context.WithoutCancel(ctx), "btrfs", "replace", "cancel", executor.Mount) })
	if err != nil {
		return err
	}
	job.Progress(1000, 1000, "permille")
	job.Detail("Using the full size of the replacement")
	if _, err := executor.Run(context.WithoutCancel(ctx), "btrfs", "filesystem", "resize", source+":max", executor.Mount); err != nil {
		return err
	}
	job.Logf("Rebuilt missing device %d onto %s", devid, device.ID)
	return executor.installBoot(ctx, job, device)
}

func (executor Executor) convert(ctx context.Context, job *operation.Job, data, metadata string) error {
	job.Detail("Rewriting block groups that use another profile")
	// soft skips chunks already in the target profile; -m also converts system chunks
	return executor.tracked(ctx, []string{"btrfs", "balance", "start", "-dconvert=" + data + ",soft", "-mconvert=" + metadata + ",soft", executor.Mount},
		func() {
			status, _ := executor.Run(context.WithoutCancel(ctx), "btrfs", "balance", "status", executor.Mount)
			if match := balanceChunks.FindStringSubmatch(status); match != nil {
				done, _ := strconv.ParseInt(match[1], 10, 64)
				total, _ := strconv.ParseInt(match[2], 10, 64)
				job.Progress(done, total, "chunks")
			}
		},
		func() { _, _ = executor.Run(context.WithoutCancel(ctx), "btrfs", "balance", "cancel", executor.Mount) })
}

// remove moves data off a member; btrfs cannot interrupt it, so cancellation waits for it to finish
func (executor Executor) remove(ctx context.Context, job *operation.Job, device host.Device, missingDevid int64) error {
	target, devid := "missing", missingDevid
	if device.ID != "" {
		member, id, err := executor.memberOf(ctx, device)
		if err != nil {
			return err
		}
		target, devid = member, id
	}
	start, _ := executor.allocatedOn(ctx, devid)
	job.Detail("Moving data to the remaining devices")
	err := executor.tracked(ctx, []string{"btrfs", "device", "remove", target, executor.Mount}, func() {
		if left, err := executor.allocatedOn(context.WithoutCancel(ctx), devid); err == nil && start > 0 {
			job.Progress(start-left, start, "bytes")
		}
	}, nil)
	if err != nil {
		return err
	}
	if device.ID != "" {
		job.Detail("Clearing the removed device")
		if _, err := executor.Run(context.WithoutCancel(ctx), "sgdisk", "--zap-all", device.Path); err != nil {
			return err
		}
	}
	job.Logf("Removed %s from the pool", target)
	return nil
}

// prepare erases the device and writes the uniform template, returning the pool partition
func (executor Executor) prepare(ctx context.Context, job *operation.Job, device host.Device) (string, error) {
	if device.Path == "" {
		return "", errors.New("the device is no longer connected")
	}
	quiet := context.WithoutCancel(ctx)
	job.Detail("Erasing existing signatures")
	for _, part := range device.Partitions {
		if _, err := executor.Run(quiet, "wipefs", "--all", "--force", part.Path); err != nil {
			return "", err
		}
	}
	if _, err := executor.Run(quiet, "wipefs", "--all", "--force", device.Path); err != nil {
		return "", err
	}
	job.Detail("Writing the partition template")
	if _, err := executor.Run(quiet, "sgdisk", "--zap-all", device.Path); err != nil {
		return "", err
	}
	boot := []string{"--new=1:0:+1M", "--typecode=1:EF02", "--change-name=1:kaordo-boot"}
	if executor.EFI {
		boot = []string{"--new=1:0:+1G", "--typecode=1:EF00", "--change-name=1:kaordo-efi"}
	}
	args := append(append([]string{"sgdisk"}, boot...), "--new=2:0:0", "--typecode=2:8300", "--change-name=2:kaordo-pool", device.Path)
	if _, err := executor.Run(quiet, args...); err != nil {
		return "", err
	}
	// sgdisk asks the kernel to reread the table; partx covers devices it could not reread
	_, _ = executor.Run(quiet, "partx", "--update", device.Path)
	member := partitionPath(device.Path, 2)
	if err := waitForNode(quiet, member); err != nil {
		return "", err
	}
	if executor.EFI {
		if _, err := executor.Run(quiet, "mkfs.vfat", "-F", "32", "-n", "KAORDO-EFI", partitionPath(device.Path, 1)); err != nil {
			return "", err
		}
	}
	job.Logf("Partitioned %s; pool member %s", device.ID, member)
	return member, nil
}

func (executor Executor) installBoot(ctx context.Context, job *operation.Job, device host.Device) error {
	if executor.Boot == nil {
		return nil
	}
	job.Detail("Installing the bootloader")
	return executor.Boot.Install(context.WithoutCancel(ctx), device)
}

// memberOf finds the pool member path and devid that live on the device
func (executor Executor) memberOf(ctx context.Context, device host.Device) (string, int64, error) {
	usage, err := executor.Run(ctx, "btrfs", "device", "usage", "-b", executor.Mount)
	if err != nil {
		return "", 0, err
	}
	paths := map[string]bool{device.Path: true}
	for _, part := range device.Partitions {
		paths[part.Path] = true
	}
	for line := range strings.SplitSeq(usage, "\n") {
		if match := usageDevice.FindStringSubmatch(line); match != nil && paths[match[1]] {
			devid, _ := strconv.ParseInt(match[2], 10, 64)
			return match[1], devid, nil
		}
	}
	return "", 0, fmt.Errorf("%s is not a member of the pool", device.ID)
}

// allocatedOn sums the chunks still allocated on a member
func (executor Executor) allocatedOn(ctx context.Context, devid int64) (int64, error) {
	usage, err := executor.Run(ctx, "btrfs", "device", "usage", "-b", executor.Mount)
	if err != nil {
		return 0, err
	}
	var total int64
	current := false
	for line := range strings.SplitSeq(usage, "\n") {
		if match := usageDevice.FindStringSubmatch(line); match != nil {
			current = match[2] == strconv.FormatInt(devid, 10)
			continue
		}
		if match := usageUsed.FindStringSubmatch(line); match != nil && current {
			value, _ := strconv.ParseInt(match[2], 10, 64)
			total += value
		}
	}
	return total, nil
}

// tracked runs a blocking tool while reading its progress. On cancellation it asks the tool to
// stop through stop (when the tool supports it) and still waits for the tool to exit.
func (executor Executor) tracked(ctx context.Context, args []string, progress func(), stop func()) error {
	result := make(chan error, 1)
	go func() {
		_, err := executor.Run(context.WithoutCancel(ctx), args...)
		result <- err
	}()
	ticker := time.NewTicker(executor.Poll)
	defer ticker.Stop()
	cancelled := ctx.Done()
	stopped := false
	for {
		select {
		case err := <-result:
			if err != nil && stopped {
				return ctx.Err()
			}
			return err
		case <-ticker.C:
			progress()
		case <-cancelled:
			cancelled = nil
			if stop != nil {
				stopped = true
				stop()
			}
		}
	}
}

// partitionPath names partition n of a disk; names ending in a digit insert a "p"
func partitionPath(disk string, number int) string {
	if last := disk[len(disk)-1]; last >= '0' && last <= '9' {
		return disk + "p" + strconv.Itoa(number)
	}
	return disk + strconv.Itoa(number)
}

func waitForNode(ctx context.Context, path string) error {
	deadline := time.Now().Add(15 * time.Second)
	for {
		if _, err := os.Stat(path); err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("partition %s did not appear", path)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}
