// Package state holds a host's desired state document, its validation and its revision history.
package state

// Defines the declarative host document that Regado edits and the reconciler converges to
import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
)

var ErrInvalid = errors.New("invalid desired state")

type Document struct {
	// Revision is assigned by the store; writers send the revision they edited.
	Revision  int64                     `json:"revision"`
	Pool      Pool                      `json:"pool"`
	Volumes   map[string]Volume         `json:"volumes"`
	Snapshots map[string]SnapshotPolicy `json:"snapshots"`
	Integrity Integrity                 `json:"integrity"`
	Backups   Backups                   `json:"backups"`
	Cleanup   Cleanup                   `json:"cleanup"`
	Alerts    Alerts                    `json:"alerts"`
}

type Pool struct {
	// Devices are stable /dev/disk/by-id names, never kernel names such as sda.
	Devices         []string `json:"devices"`
	DataProfile     string   `json:"dataProfile"`
	MetadataProfile string   `json:"metadataProfile"`
}

type Volume struct {
	QuotaBytes *int64 `json:"quotaBytes"`
}

type SnapshotPolicy struct {
	Schedule    string `json:"schedule"`
	KeepHourly  int    `json:"keepHourly"`
	KeepDaily   int    `json:"keepDaily"`
	KeepWeekly  int    `json:"keepWeekly"`
	KeepMonthly int    `json:"keepMonthly"`
}

type Integrity struct {
	Scrub      string `json:"scrub"`
	SmartShort string `json:"smartShort"`
	SmartLong  string `json:"smartLong"`
}

type Backups struct {
	Targets  []BackupTarget `json:"targets"`
	Policies []BackupPolicy `json:"policies"`
}

type BackupTarget struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Device string `json:"device"`
}

type BackupPolicy struct {
	Volume      string `json:"volume"`
	Target      string `json:"target"`
	Schedule    string `json:"schedule"`
	KeepDaily   int    `json:"keepDaily"`
	KeepWeekly  int    `json:"keepWeekly"`
	KeepMonthly int    `json:"keepMonthly"`
}

type Cleanup struct {
	// NixGenerationsDays removes older system generations; zero keeps them all.
	NixGenerationsDays int `json:"nixGenerationsDays"`
	ReleasesKeep       int `json:"releasesKeep"`
	// JournalDays limits the age of the host journal; zero keeps only the size budget.
	JournalDays int `json:"journalDays"`
}

type Alerts struct {
	PoolWarningPercent  int          `json:"poolWarningPercent"`
	PoolCriticalPercent int          `json:"poolCriticalPercent"`
	Ntfy                *NtfyChannel `json:"ntfy"`
}

type NtfyChannel struct {
	URL   string `json:"url"`
	Topic string `json:"topic"`
}

// Volumes whose subvolumes and mounts the NixOS module declares
var Volumes = []string{"system", "nix", "log", "postgresql", "media", "prometheus", "releases"}

var (
	devicePattern = regexp.MustCompile(`^(wwn-0x[0-9a-f]{8,32}|(ata|nvme|scsi|usb|virtio|loop)-[A-Za-z0-9_.:-]{1,96})$`)
	idPattern     = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)
	topicPattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)
)

// Default is the policy a host starts with: two copies, daily snapshots and monthly checks.
func Default(devices []string) Document {
	data, metadata := "raid1", "auto"
	if len(devices) < 2 {
		data, metadata = "single", "dup"
	}
	return Document{
		Pool:    Pool{Devices: devices, DataProfile: data, MetadataProfile: metadata},
		Volumes: map[string]Volume{},
		Snapshots: map[string]SnapshotPolicy{
			"postgresql": {Schedule: "hourly", KeepHourly: 24, KeepDaily: 7, KeepWeekly: 4, KeepMonthly: 3},
			"media":      {Schedule: "daily", KeepDaily: 7, KeepWeekly: 4, KeepMonthly: 3},
			"system":     {Schedule: "daily", KeepDaily: 7, KeepWeekly: 2},
		},
		Integrity: Integrity{Scrub: "monthly", SmartShort: "weekly", SmartLong: "monthly"},
		Backups:   Backups{Targets: []BackupTarget{}, Policies: []BackupPolicy{}},
		Cleanup:   Cleanup{NixGenerationsDays: 30, ReleasesKeep: 3, JournalDays: 14},
		Alerts:    Alerts{PoolWarningPercent: 80, PoolCriticalPercent: 90},
	}
}

// Validate checks the whole document; the error names the first invalid field.
func (document Document) Validate() error {
	for _, check := range []func() error{
		document.Pool.validate, document.validateVolumes, document.validateSnapshots,
		document.Integrity.validate, document.validateBackups, document.Cleanup.validate,
		document.Alerts.validate,
	} {
		if err := check(); err != nil {
			return fmt.Errorf("%w: %w", ErrInvalid, err)
		}
	}
	return nil
}

func (pool Pool) validate() error {
	if len(pool.Devices) == 0 || len(pool.Devices) > 64 {
		return errors.New("the pool needs 1 to 64 devices")
	}
	for index, device := range pool.Devices {
		if !devicePattern.MatchString(device) || slices.Index(pool.Devices, device) != index {
			return fmt.Errorf("device %q must be a unique /dev/disk/by-id name", device)
		}
	}
	copies := map[string]int{"single": 1, "dup": 1, "raid1": 2, "raid1c3": 3}
	data, ok := copies[pool.DataProfile]
	if !ok || pool.DataProfile == "dup" || data > len(pool.Devices) {
		return fmt.Errorf("data profile %q does not fit %d devices", pool.DataProfile, len(pool.Devices))
	}
	if pool.MetadataProfile != "auto" {
		metadata, ok := copies[pool.MetadataProfile]
		if !ok || metadata > len(pool.Devices) || metadata < data {
			return fmt.Errorf("metadata profile %q must fit the devices and keep at least as many copies as data", pool.MetadataProfile)
		}
	}
	return nil
}

func (document Document) validateVolumes() error {
	for name, volume := range document.Volumes {
		if !slices.Contains(Volumes, name) {
			return fmt.Errorf("unknown volume %q", name)
		}
		if volume.QuotaBytes != nil && *volume.QuotaBytes < 1<<30 {
			return fmt.Errorf("the quota of %s must be at least 1 GiB", name)
		}
	}
	return nil
}

func (document Document) validateSnapshots() error {
	for name, policy := range document.Snapshots {
		if !slices.Contains(Volumes, name) {
			return fmt.Errorf("unknown snapshot volume %q", name)
		}
		if err := policy.validate(); err != nil {
			return fmt.Errorf("snapshots of %s: %w", name, err)
		}
	}
	return nil
}

func (policy SnapshotPolicy) validate() error {
	if !slices.Contains([]string{"off", "hourly", "daily"}, policy.Schedule) {
		return fmt.Errorf("unknown schedule %q", policy.Schedule)
	}
	for _, keep := range []int{policy.KeepHourly, policy.KeepDaily, policy.KeepWeekly, policy.KeepMonthly} {
		if keep < 0 || keep > 1000 {
			return errors.New("retention counts must be between 0 and 1000")
		}
	}
	if policy.Schedule != "off" && policy.KeepHourly+policy.KeepDaily+policy.KeepWeekly+policy.KeepMonthly == 0 {
		return errors.New("an active schedule must keep at least one snapshot")
	}
	return nil
}

func (integrity Integrity) validate() error {
	for _, check := range []struct{ name, value string }{
		{"scrub", integrity.Scrub}, {"SMART short test", integrity.SmartShort}, {"SMART long test", integrity.SmartLong},
	} {
		if !slices.Contains([]string{"off", "weekly", "monthly"}, check.value) {
			return fmt.Errorf("%s schedule %q must be off, weekly or monthly", check.name, check.value)
		}
	}
	return nil
}

func (document Document) validateBackups() error {
	targets := map[string]bool{}
	for _, target := range document.Backups.Targets {
		if !idPattern.MatchString(target.ID) || targets[target.ID] || target.Kind != "disk" ||
			!devicePattern.MatchString(target.Device) || slices.Contains(document.Pool.Devices, target.Device) {
			return fmt.Errorf("backup target %q must be a unique disk outside the pool", target.ID)
		}
		targets[target.ID] = true
	}
	for _, policy := range document.Backups.Policies {
		if !slices.Contains(Volumes, policy.Volume) || !targets[policy.Target] ||
			!slices.Contains([]string{"hourly", "daily", "weekly"}, policy.Schedule) {
			return fmt.Errorf("backup policy for %q must name a volume, a target and a schedule", policy.Volume)
		}
		if policy.KeepDaily < 0 || policy.KeepWeekly < 0 || policy.KeepMonthly < 0 ||
			policy.KeepDaily+policy.KeepWeekly+policy.KeepMonthly == 0 {
			return fmt.Errorf("backup policy for %q must keep at least one backup", policy.Volume)
		}
	}
	return nil
}

func (cleanup Cleanup) validate() error {
	if cleanup.NixGenerationsDays < 0 || cleanup.NixGenerationsDays > 3650 {
		return errors.New("the Nix generation age must be between 0 and 3650 days")
	}
	if cleanup.ReleasesKeep < 2 || cleanup.ReleasesKeep > 50 {
		return errors.New("keep between 2 and 50 releases so the previous one can be restored")
	}
	if !slices.Contains([]int{0, 1, 7, 14, 30, 90}, cleanup.JournalDays) {
		return errors.New("journal age must be 0, 1, 7, 14, 30 or 90 days")
	}
	return nil
}

func (alerts Alerts) validate() error {
	if alerts.PoolWarningPercent < 50 || alerts.PoolCriticalPercent > 99 || alerts.PoolWarningPercent >= alerts.PoolCriticalPercent {
		return errors.New("pool alert thresholds must satisfy 50 ≤ warning < critical ≤ 99")
	}
	if alerts.Ntfy == nil {
		return nil
	}
	server, err := url.Parse(alerts.Ntfy.URL)
	if err != nil || server.Scheme != "https" || server.Host == "" || server.User != nil || server.RawQuery != "" {
		return errors.New("the ntfy server must be an https URL without credentials")
	}
	if !topicPattern.MatchString(alerts.Ntfy.Topic) {
		return errors.New("the ntfy topic must be 8 to 64 letters, digits, dashes or underscores")
	}
	return nil
}
