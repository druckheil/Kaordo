package agent

// Measures journal storage and applies persistent retention through native journald rotation
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const journalPolicyLink = "/etc/systemd/journald.conf.d/90-kaordo-retention.conf"

var journalPolicyMu sync.Mutex

type journalStatus struct {
	TotalBytes    *int64 `json:"totalBytes"`
	DiskBytes     *int64 `json:"diskBytes"`
	RuntimeBytes  *int64 `json:"runtimeBytes"`
	MaxUseBytes   *int64 `json:"maxUseBytes"`
	RetentionDays *int   `json:"retentionDays"`
	Managed       bool   `json:"managed"`
	Warning       string `json:"warning,omitempty"`
}

func journalPolicyPath() string {
	return filepath.Join(storageStateDirectory(), "journald-retention.conf")
}

func journalPolicyManaged(link, policy string) bool {
	target, err := filepath.EvalSymlinks(link)
	if err != nil {
		return false
	}
	expected, err := filepath.EvalSymlinks(policy)
	return err == nil && target == expected
}

func readJournalStatus(ctx context.Context, run commandRunner) journalStatus {
	status := journalStatus{DiskBytes: journalBytes(ctx, "/var/log/journal"), RuntimeBytes: journalBytes(ctx, "/run/log/journal"), Managed: journalPolicyManaged(journalPolicyLink, journalPolicyPath())}
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
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() || !(strings.HasSuffix(entry.Name(), ".journal") || strings.HasSuffix(entry.Name(), ".journal~")) {
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

func validJournalDays(days int) bool {
	switch days {
	case 0, 1, 7, 14, 30, 90:
		return true
	}
	return false
}

func writeJournalPolicy(path string, content []byte) error {
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

func applyJournalRetention(ctx context.Context, run commandRunner, days int, link, policy string) (journalStatus, error) {
	if !validJournalDays(days) {
		return journalStatus{}, errors.New("unsupported journal retention")
	}
	journalPolicyMu.Lock()
	defer journalPolicyMu.Unlock()
	if err := ctx.Err(); err != nil {
		return journalStatus{}, err
	}
	if !journalPolicyManaged(link, policy) {
		return journalStatus{}, errors.New("journal policy integration is unavailable")
	}
	previous, err := os.ReadFile(policy)
	if err != nil {
		return journalStatus{}, err
	}
	content := []byte(fmt.Sprintf("# Managed by Regado; storage budget belongs to the NixOS module\n[Journal]\nMaxRetentionSec=%dday\n", days))
	if err := writeJournalPolicy(policy, content); err != nil {
		return journalStatus{}, err
	}
	status := readJournalStatus(ctx, run)
	if status.RetentionDays == nil || *status.RetentionDays != days {
		return journalStatus{}, errors.Join(errors.New("the host configuration overrides this retention policy"), writeJournalPolicy(policy, previous))
	}
	if _, err := run(ctx, "systemctl", "restart", "systemd-journald.service"); err != nil {
		restoreErr := writeJournalPolicy(policy, previous)
		if restoreErr == nil {
			restoreCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
			_, restoreErr = run(restoreCtx, "systemctl", "restart", "systemd-journald.service")
			stop()
		}
		return journalStatus{}, errors.Join(err, restoreErr)
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
	status = readJournalStatus(ctx, run)
	if cleanupErr != nil {
		status.Warning = "Retention was saved, but archived-journal cleanup could not complete."
	}
	return status, nil
}

func journalRetentionHandler(run commandRunner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Days *int `json:"retentionDays"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		err := decoder.Decode(&body)
		var extra any
		if err != nil || body.Days == nil || !validJournalDays(*body.Days) || !errors.Is(decoder.Decode(&extra), io.EOF) {
			http.Error(w, "invalid retention policy", http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		status, err := applyJournalRetention(ctx, run, *body.Days, journalPolicyLink, journalPolicyPath())
		respond(w, status, err)
	}
}
