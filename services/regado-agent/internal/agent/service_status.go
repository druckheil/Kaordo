package agent

// Reads native service outcomes and timer schedules and triggers scheduled DNS checks
import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

type serviceTimer struct {
	ID        string  `json:"id"`
	Active    string  `json:"active"`
	Substate  string  `json:"substate"`
	LastRunAt *string `json:"lastRunAt"`
	NextRunAt *string `json:"nextRunAt"`
}

func readServiceStatuses(ctx context.Context, run commandRunner) []service {
	statuses := make([]service, 0, len(services))
	for _, id := range services {
		raw, _ := run(ctx, "systemctl", "show", id+".service", "--timestamp=unix", "--property=ActiveState,SubState,LoadState,Type,Result,ExecMainStatus,ExecMainExitTimestamp", "--no-pager")
		status := parseServiceStatus(id, raw)
		if id == "ddclient" {
			status.Timer = readServiceTimer(ctx, run, id+".timer")
		}
		statuses = append(statuses, status)
	}
	return statuses
}

func systemProperties(raw string) map[string]string {
	values := make(map[string]string)
	for line := range strings.SplitSeq(raw, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok {
			values[key] = value
		}
	}
	return values
}

func parseServiceStatus(id, raw string) service {
	values := systemProperties(raw)
	status := service{ID: id, Active: values["ActiveState"], Substate: values["SubState"], Loaded: values["LoadState"], Type: values["Type"], Result: values["Result"]}
	if code, err := strconv.Atoi(values["ExecMainStatus"]); err == nil {
		status.ExitCode = &code
	}
	if timestamp := strings.TrimPrefix(values["ExecMainExitTimestamp"], "@"); timestamp != values["ExecMainExitTimestamp"] {
		if seconds, err := strconv.ParseInt(timestamp, 10, 64); err == nil && seconds > 0 {
			value := time.Unix(seconds, 0).UTC().Format(time.RFC3339)
			status.FinishedAt = &value
		}
	}
	return status
}

func readServiceTimer(ctx context.Context, run commandRunner, id string) *serviceTimer {
	raw, err := run(ctx, "systemctl", "show", id, "--property=ActiveState,SubState", "--no-pager")
	if err != nil {
		return nil
	}
	values := systemProperties(raw)
	timer := &serviceTimer{ID: id, Active: values["ActiveState"], Substate: values["SubState"]}
	raw, err = run(ctx, "systemctl", "list-timers", id, "--all", "--output=json", "--no-pager")
	if err != nil {
		return timer
	}
	var rows []struct {
		Unit string `json:"unit"`
		Last uint64 `json:"last"`
		Next uint64 `json:"next"`
	}
	if json.Unmarshal([]byte(raw), &rows) != nil {
		return timer
	}
	for _, row := range rows {
		if row.Unit == id {
			timer.LastRunAt, timer.NextRunAt = timerTimestamp(row.Last), timerTimestamp(row.Next)
		}
	}
	return timer
}

func timerTimestamp(microseconds uint64) *string {
	// systemd uses infinity for unavailable deadlines; do not turn it into a plausible date
	if microseconds == 0 || microseconds >= 253402300800000000 {
		return nil
	}
	value := time.UnixMicro(int64(microseconds)).UTC().Format(time.RFC3339)
	return &value
}

func updateDNS(ctx context.Context, run commandRunner) (string, error) {
	if _, err := run(ctx, "systemctl", "start", "ddclient.timer"); err != nil {
		return "", err
	}
	if _, err := run(ctx, "systemctl", "start", "ddclient.service"); err != nil {
		return "", err
	}
	return "DNS check completed. Automatic updates remain scheduled.", nil
}
