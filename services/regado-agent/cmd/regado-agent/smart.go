package main

import (
	"context"
	"encoding/json"
	"regexp"
	"sync"
	"time"
)

var physicalDevice = regexp.MustCompile(`^/dev/(sd[a-z]+|vd[a-z]+|nvme[0-9]+n[0-9]+)$`)

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
}

func (monitor *smartMonitor) read(ctx context.Context, run commandRunner, path string) smartHealth {
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	if cached, ok := monitor.entries[path]; ok && time.Since(cached.CheckedAt) < 5*time.Minute {
		return cached
	}
	// smartctl exit codes are a bitmask: a failing drive still returns useful JSON.
	// Do not wake sleeping disks to refresh a dashboard.
	raw, _ := run(ctx, "smartctl", "--json", "--all", "--nocheck=standby,3", path)
	item := parseSMART(raw)
	item.CheckedAt = time.Now().UTC()
	monitor.entries[path] = item
	return item
}

func parseSMART(raw string) smartHealth {
	item := smartHealth{State: "unavailable"}
	var report struct {
		Smartctl struct {
			ExitStatus int `json:"exit_status"`
		} `json:"smartctl"`
		Status struct {
			Passed *bool `json:"passed"`
		} `json:"smart_status"`
		Temperature struct {
			Current *int `json:"current"`
		} `json:"temperature"`
		PowerOn struct {
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
	if json.Unmarshal([]byte(raw), &report) != nil {
		return item
	}
	item.Passed, item.TemperatureC, item.PowerOnHours = report.Status.Passed, report.Temperature.Current, report.PowerOn.Hours
	if report.Status.Passed == nil {
		if report.Smartctl.ExitStatus == 3 {
			item.State = "standby"
		}
		return item
	}
	item.State = "passed"
	if !*report.Status.Passed {
		item.State = "failed"
	}
	for _, attribute := range report.Attributes.Table {
		value := attribute.Raw.Value
		switch attribute.ID {
		case 5:
			item.ReallocatedSectors = &value
		case 197:
			item.PendingSectors = &value
		case 198:
			item.UncorrectableSectors = &value
		default:
			continue
		}
		if value > 0 && item.State == "passed" {
			item.State = "warning"
		}
	}
	return item
}
