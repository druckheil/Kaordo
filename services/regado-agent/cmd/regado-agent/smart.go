package main

// Schedules bounded SMART reads and maps smartctl reports to disk health
import (
	"context"
	"encoding/json"
	"regexp"
	"sync"
	"time"
)

const (
	smartCacheTTL        = 5 * time.Minute
	smartReadTimeout     = 8 * time.Second
	smartQueueTimeout    = 2 * time.Minute
	smartReadConcurrency = 4

	smartStateUnavailable = "unavailable"
	smartStateStandby     = "standby"
	smartStatePassed      = "passed"
	smartStateWarning     = "warning"
	smartStateFailed      = "failed"

	reallocatedSectorsAttributeID   = 5
	pendingSectorsAttributeID       = 197
	uncorrectableSectorsAttributeID = 198
)

var physicalDevice = regexp.MustCompile(`^/dev/(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme[0-9]+n[0-9]+|mmcblk[0-9]+)$`)

type smartHealth struct {
	State                string    `json:"state"`
	Passed               *bool     `json:"passed"`
	TemperatureC         *int      `json:"temperatureC"`
	PowerOnHours         *int64    `json:"powerOnHours"`
	ReallocatedSectors   *int64    `json:"reallocatedSectors"`
	PendingSectors       *int64    `json:"pendingSectors"`
	UncorrectableSectors *int64    `json:"uncorrectableSectors"`
	CheckedAt            time.Time `json:"checkedAt"`
}

type smartMonitor struct {
	mu      sync.Mutex
	entries map[string]smartHealth
	pending map[string]bool
	slots   chan struct{}
}

type smartctlReport struct {
	Smartctl      smartctlMetadata      `json:"smartctl"`
	Status        smartctlStatus        `json:"smart_status"`
	Temperature   smartctlTemperature   `json:"temperature"`
	PowerOnTime   smartctlPowerOnTime   `json:"power_on_time"`
	ATAAttributes smartctlATAAttributes `json:"ata_smart_attributes"`
}

type smartctlMetadata struct {
	ExitStatus int `json:"exit_status"`
}

type smartctlStatus struct {
	Passed *bool `json:"passed"`
}

type smartctlTemperature struct {
	Current *int `json:"current"`
}

type smartctlPowerOnTime struct {
	Hours *int64 `json:"hours"`
}

type smartctlATAAttributes struct {
	Table []smartctlAttribute `json:"table"`
}

type smartctlAttribute struct {
	ID  int              `json:"id"`
	Raw smartctlRawValue `json:"raw"`
}

type smartctlRawValue struct {
	Value int64 `json:"value"`
}

func (monitor *smartMonitor) read(run commandRunner, path string) (smartHealth, bool) {
	monitor.mu.Lock()
	if monitor.entries == nil {
		monitor.entries = make(map[string]smartHealth)
	}
	if monitor.pending == nil {
		monitor.pending = make(map[string]bool)
	}
	if monitor.slots == nil {
		monitor.slots = make(chan struct{}, smartReadConcurrency)
	}
	cached, exists := monitor.entries[path]
	if exists && time.Since(cached.CheckedAt) < smartCacheTTL {
		monitor.mu.Unlock()
		return cached, true
	}
	if !monitor.pending[path] {
		monitor.pending[path] = true
		go monitor.refresh(run, path, monitor.slots)
	}
	monitor.mu.Unlock()
	return cached, exists
}

func (monitor *smartMonitor) refresh(run commandRunner, path string, slots chan struct{}) {
	defer func() {
		monitor.mu.Lock()
		delete(monitor.pending, path)
		monitor.mu.Unlock()
	}()
	select {
	case slots <- struct{}{}:
		defer func() { <-slots }()
	case <-time.After(smartQueueTimeout):
		return
	}

	// smartctl exit codes are a bitmask: a failing drive still returns useful JSON.
	// Do not wake sleeping disks to refresh a dashboard.
	ctx, cancel := context.WithTimeout(context.Background(), smartReadTimeout)
	defer cancel()
	raw, _ := run(ctx, "smartctl", "--json", "--all", "--nocheck=standby,3", path)
	item := parseSMART(raw)
	item.CheckedAt = time.Now().UTC()

	monitor.mu.Lock()
	monitor.entries[path] = item
	monitor.mu.Unlock()
}

func parseSMART(raw string) smartHealth {
	report, err := decodeSMARTReport(raw)
	if err != nil {
		return smartHealth{State: smartStateUnavailable}
	}
	return healthFromSMARTReport(report)
}

func decodeSMARTReport(raw string) (smartctlReport, error) {
	var report smartctlReport
	if err := json.Unmarshal([]byte(raw), &report); err != nil {
		return smartctlReport{}, err
	}
	return report, nil
}

func healthFromSMARTReport(report smartctlReport) smartHealth {
	item := smartHealth{
		State:        smartStateUnavailable,
		Passed:       report.Status.Passed,
		TemperatureC: report.Temperature.Current,
		PowerOnHours: report.PowerOnTime.Hours,
	}
	if report.Status.Passed == nil {
		if report.Smartctl.ExitStatus == 3 {
			item.State = smartStateStandby
		}
		return item
	}

	item.State = smartStateFailed
	if *report.Status.Passed {
		item.State = smartStatePassed
	}
	for _, attribute := range report.ATAAttributes.Table {
		applySMARTAttribute(&item, attribute)
	}
	return item
}

func applySMARTAttribute(item *smartHealth, attribute smartctlAttribute) {
	value := attribute.Raw.Value
	switch attribute.ID {
	case reallocatedSectorsAttributeID:
		item.ReallocatedSectors = &value
	case pendingSectorsAttributeID:
		item.PendingSectors = &value
	case uncorrectableSectorsAttributeID:
		item.UncorrectableSectors = &value
	default:
		return
	}
	if value > 0 && item.State == smartStatePassed {
		item.State = smartStateWarning
	}
}
