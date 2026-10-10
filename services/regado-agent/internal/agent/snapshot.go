package agent

// Collects host telemetry, swap devices and service states for the System view
import (
	"context"
	"os"
	"strconv"
	"strings"
	"time"
)

type swapDevice struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Kind     string `json:"kind"`
	Size     int64  `json:"size"`
	Used     int64  `json:"used"`
	Priority int    `json:"priority"`
}

type service struct {
	ID         string        `json:"id"`
	Active     string        `json:"active"`
	Substate   string        `json:"substate"`
	Loaded     string        `json:"loaded"`
	Type       string        `json:"type,omitempty"`
	Result     string        `json:"result,omitempty"`
	ExitCode   *int          `json:"exitCode,omitempty"`
	FinishedAt *string       `json:"finishedAt,omitempty"`
	Timer      *serviceTimer `json:"timer,omitempty"`
}

func snapshot(ctx context.Context, run commandRunner) map[string]any {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	hostname, _ := os.Hostname()
	return map[string]any{
		"hostname":    hostname,
		"host":        readHostInfo(),
		"swapDevices": readSwapDevices(),
		"services":    readServiceStatuses(ctx, run),
		"time":        time.Now().UTC(),
	}
}

func readSwapDevices() []swapDevice {
	contents, err := os.ReadFile("/proc/swaps")
	if err != nil {
		return []swapDevice{}
	}
	return parseSwapDevices(string(contents))
}

func parseSwapDevices(raw string) []swapDevice {
	lines := strings.Split(raw, "\n")
	result := make([]swapDevice, 0, max(0, len(lines)-1))
	for _, line := range lines[1:] {
		fields := strings.Fields(line)
		if len(fields) != 5 {
			continue
		}
		sizeKiB, sizeErr := strconv.ParseInt(fields[2], 10, 64)
		usedKiB, usedErr := strconv.ParseInt(fields[3], 10, 64)
		priority, priorityErr := strconv.Atoi(fields[4])
		if sizeErr != nil || usedErr != nil || priorityErr != nil {
			continue
		}
		path := fields[0]
		name := path
		if index := strings.LastIndex(path, "/"); index >= 0 {
			name = path[index+1:]
		}
		kind := "disk swap"
		if strings.HasPrefix(name, "zram") {
			kind = "compressed RAM"
		} else if fields[1] == "file" {
			kind = "swap file"
		}
		result = append(result, swapDevice{Name: name, Path: path, Kind: kind, Size: sizeKiB * 1024, Used: usedKiB * 1024, Priority: priority})
	}
	return result
}
