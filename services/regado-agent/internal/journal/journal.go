// Package journal measures the host journal and applies its retention through native journald rotation.
package journal

// Reads journald's effective settings and storage, and rewrites the retention drop-in safely
import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
)

// DefaultLink is the drop-in the NixOS module points at the agent's policy file.
const DefaultLink = "/etc/systemd/journald.conf.d/90-kaordo-retention.conf"

// Policy is the retention file the agent owns and the journald drop-in that links to it.
type Policy struct {
	Link string
	Path string
}

var policyMu sync.Mutex

type Status struct {
	TotalBytes    *int64 `json:"totalBytes"`
	DiskBytes     *int64 `json:"diskBytes"`
	RuntimeBytes  *int64 `json:"runtimeBytes"`
	MaxUseBytes   *int64 `json:"maxUseBytes"`
	RetentionDays *int   `json:"retentionDays"`
	Managed       bool   `json:"managed"`
	Warning       string `json:"warning,omitempty"`
}

// managed reports whether journald reads this policy file through the drop-in link
func (policy Policy) managed() bool {
	target, err := filepath.EvalSymlinks(policy.Link)
	if err != nil {
		return false
	}
	expected, err := filepath.EvalSymlinks(policy.Path)
	return err == nil && target == expected
}

// Status measures journal storage and reads journald's effective size and age limits.
func (policy Policy) Status(ctx context.Context, run command.Runner) Status {
	status := Status{DiskBytes: journalBytes(ctx, "/var/log/journal"), RuntimeBytes: journalBytes(ctx, "/run/log/journal"), Managed: policy.managed()}
	if status.DiskBytes != nil || status.RuntimeBytes != nil {
		total := int64(0)
		for _, value := range []*int64{status.DiskBytes, status.RuntimeBytes} {
			if value != nil {
				total += *value
			}
		}
		status.TotalBytes = &total
	}
	if raw, err := run(ctx, "systemd-analyze", "cat-config", "systemd/journald.conf"); err == nil {
		settings := journalSettings(raw)
		status.MaxUseBytes = journalSize(settings["SystemMaxUse"])
		status.RetentionDays = journalDays(settings["MaxRetentionSec"])
	}
	return status
}

func journalBytes(ctx context.Context, root string) *int64 {
	total := int64(0)
	err := filepath.WalkDir(root, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		journal := strings.HasSuffix(entry.Name(), ".journal") || strings.HasSuffix(entry.Name(), ".journal~")
		if entry.IsDir() || !journal {
			return nil
		}
		info, err := entry.Info()
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			if stat, ok := info.Sys().(*syscall.Stat_t); ok {
				total += stat.Blocks * 512
			} else {
				total += info.Size()
			}
		}
		return nil
	})
	if err != nil {
		return nil
	}
	return &total
}

func journalSettings(raw string) map[string]string {
	settings := make(map[string]string)
	for line := range strings.SplitSeq(raw, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if key, value, ok := strings.Cut(line, "="); ok {
			settings[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	return settings
}

func journalSize(raw string) *int64 {
	multiplier := int64(1)
	for suffix, factor := range map[string]int64{"K": 1 << 10, "M": 1 << 20, "G": 1 << 30, "T": 1 << 40} {
		if strings.HasSuffix(raw, suffix) {
			raw, multiplier = strings.TrimSuffix(raw, suffix), factor
			break
		}
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 || value > (1<<63-1)/multiplier {
		return nil
	}
	value *= multiplier
	return &value
}

func journalDays(raw string) *int {
	multiplier := int64(1)
	for _, unit := range []struct {
		suffix string
		factor int64
	}{{"days", 86400}, {"day", 86400}, {"d", 86400}, {"h", 3600}, {"s", 1}} {
		if strings.HasSuffix(raw, unit.suffix) {
			raw, multiplier = strings.TrimSuffix(raw, unit.suffix), unit.factor
			break
		}
	}
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 32)
	if err != nil || value < 0 {
		return nil
	}
	seconds := value * multiplier
	if seconds%86400 != 0 {
		return nil
	}
	days := int(seconds / 86400)
	return &days
}

// ValidDays lists the retention periods Regado offers; zero keeps only the size budget.
func ValidDays(days int) bool {
	switch days {
	case 0, 1, 7, 14, 30, 90:
		return true
	}
	return false
}

func writePolicy(path string, content []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".journal-policy-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, err = file.Write(content)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), path)
}

// Apply writes the retention, restarts journald and removes archives beyond it. A failed restart
// or an overriding host setting restores the previous policy before returning.
func (policy Policy) Apply(ctx context.Context, run command.Runner, days int) (Status, error) {
	if !ValidDays(days) {
		return Status{}, errors.New("unsupported journal retention")
	}
	policyMu.Lock()
	defer policyMu.Unlock()
	if err := ctx.Err(); err != nil {
		return Status{}, err
	}
	if !policy.managed() {
		return Status{}, errors.New("journal policy integration is unavailable")
	}
	previous, err := os.ReadFile(policy.Path) //nolint:gosec // fixed journald drop-in path
	if err != nil {
		return Status{}, err
	}
	content := []byte(fmt.Sprintf("# Managed by Regado; storage budget belongs to the NixOS module\n[Journal]\nMaxRetentionSec=%dday\n", days))
	if err := writePolicy(policy.Path, content); err != nil {
		return Status{}, err
	}
	status := policy.Status(ctx, run)
	if status.RetentionDays == nil || *status.RetentionDays != days {
		return Status{}, errors.Join(errors.New("the host configuration overrides this retention policy"), writePolicy(policy.Path, previous))
	}
	if _, err := run(ctx, "systemctl", "restart", "systemd-journald.service"); err != nil {
		restoreErr := writePolicy(policy.Path, previous)
		if restoreErr == nil {
			restoreCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
			_, restoreErr = run(restoreCtx, "systemctl", "restart", "systemd-journald.service")
			stop()
		}
		return Status{}, errors.Join(err, restoreErr)
	}
	// Native vacuum removes only archived journals; rotate first so the requested age can take effect
	_, cleanupErr := run(ctx, "journalctl", "--rotate")
	if cleanupErr == nil {
		args := []string{"journalctl"}
		if days > 0 {
			args = append(args, fmt.Sprintf("--vacuum-time=%dd", days))
		}
		if status.MaxUseBytes != nil {
			args = append(args, fmt.Sprintf("--vacuum-size=%d", *status.MaxUseBytes))
		}
		if len(args) > 1 {
			_, cleanupErr = run(ctx, args...)
		}
	}
	status = policy.Status(ctx, run)
	if cleanupErr != nil {
		status.Warning = "Retention was saved, but archived-journal cleanup could not complete."
	}
	return status, nil
}
