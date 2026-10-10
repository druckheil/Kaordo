package host

// Reads SMART health without waking sleeping disks and keeps the latest report per device
import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
)

type HealthState string

const (
	HealthUnavailable HealthState = "unavailable"
	HealthStandby     HealthState = "standby"
	HealthPassed      HealthState = "passed"
	HealthWarning     HealthState = "warning"
	HealthFailed      HealthState = "failed"
)

// Health is a device's SMART verdict and the counters that predict failure.
type Health struct {
	State                HealthState `json:"state"`
	Passed               *bool       `json:"passed"`
	TemperatureC         *int        `json:"temperatureC"`
	PowerOnHours         *int64      `json:"powerOnHours"`
	ReallocatedSectors   *int64      `json:"reallocatedSectors"`
	PendingSectors       *int64      `json:"pendingSectors"`
	UncorrectableSectors *int64      `json:"uncorrectableSectors"`
	CheckedAt            time.Time   `json:"checkedAt"`
}

const (
	healthReadTimeout = 8 * time.Second

	reallocatedSectorsAttribute   = 5
	pendingSectorsAttribute       = 197
	uncorrectableSectorsAttribute = 198
)

type smartctlReport struct {
	Smartctl struct {
		ExitStatus int `json:"exit_status"`
	} `json:"smartctl"`
	Status struct {
		Passed *bool `json:"passed"`
	} `json:"smart_status"`
	Temperature struct {
		Current *int `json:"current"`
	} `json:"temperature"`
	PowerOnTime struct {
		Hours *int64 `json:"hours"`
	} `json:"power_on_time"`
	Attributes struct {
		Table []struct {
			ID  int `json:"id"`
			Raw struct {
				Value int64 `json:"value"`
			} `json:"raw"`
		} `json:"table"`
	} `json:"ata_smart_attributes"`
}

// ReadHealth asks smartctl for one device. Its exit code is a bitmask, so a failing drive
// still returns a useful report; sleeping disks report standby instead of spinning up.
func ReadHealth(ctx context.Context, run command.Runner, path string) Health {
	ctx, cancel := context.WithTimeout(ctx, healthReadTimeout)
	defer cancel()
	raw, _ := run(ctx, "smartctl", "--json", "--all", "--nocheck=standby,3", path)
	return ParseHealth(raw)
}

func ParseHealth(raw string) Health {
	var report smartctlReport
	if json.Unmarshal([]byte(raw), &report) != nil {
		return Health{State: HealthUnavailable}
	}
	health := Health{
		State:        HealthUnavailable,
		Passed:       report.Status.Passed,
		TemperatureC: report.Temperature.Current,
		PowerOnHours: report.PowerOnTime.Hours,
	}
	if report.Status.Passed == nil {
		if report.Smartctl.ExitStatus == 3 {
			health.State = HealthStandby
		}
		return health
	}
	health.State = HealthFailed
	if *report.Status.Passed {
		health.State = HealthPassed
	}
	for _, attribute := range report.Attributes.Table {
		value := attribute.Raw.Value
		switch attribute.ID {
		case reallocatedSectorsAttribute:
			health.ReallocatedSectors = &value
		case pendingSectorsAttribute:
			health.PendingSectors = &value
		case uncorrectableSectorsAttribute:
			health.UncorrectableSectors = &value
		default:
			continue
		}
		if value > 0 && health.State == HealthPassed {
			health.State = HealthWarning
		}
	}
	return health
}

// HealthMonitor keeps the latest report per device ID for fact reads that must stay fast.
type HealthMonitor struct {
	mu      sync.RWMutex
	reports map[string]Health
}

func (monitor *HealthMonitor) Lookup(id string) *Health {
	monitor.mu.RLock()
	defer monitor.mu.RUnlock()
	if report, ok := monitor.reports[id]; ok {
		return &report
	}
	return nil
}

// Refresh reads each identified device in turn and forgets devices that are gone. A sleeping
// disk keeps its last report, which is still the latest evidence about it.
func (monitor *HealthMonitor) Refresh(ctx context.Context, run command.Runner, devices []Device, now func() time.Time) {
	reports := make(map[string]Health, len(devices))
	for _, device := range devices {
		if ctx.Err() != nil {
			return
		}
		if device.ID == "" {
			continue
		}
		report := ReadHealth(ctx, run, device.Path)
		report.CheckedAt = now().UTC()
		if previous := monitor.Lookup(device.ID); report.State == HealthStandby && previous != nil {
			report = *previous
		}
		reports[device.ID] = report
	}
	monitor.mu.Lock()
	monitor.reports = reports
	monitor.mu.Unlock()
}
