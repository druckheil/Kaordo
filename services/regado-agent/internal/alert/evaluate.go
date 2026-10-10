package alert

// Derives the conditions that deserve an operator's attention from devices, pool, state and operations
import (
	"fmt"
	"maps"
	"slices"
	"strconv"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/deployment"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/storage"
)

// Inputs is what the agent knows about its host at one moment.
type Inputs struct {
	Devices []host.Device
	Pool    host.Pool
	Desired state.Document
	Drift   storage.Plan
	// Operations are recent operations, newest first
	Operations []operation.Operation
	// FullInDays projects the last week's growth onto the free space; nil when nothing grows
	FullInDays *float64
	// Deployment is the automatic deployment's state; nil when the host has none
	Deployment *deployment.State
}

// operationAlerts names the operations whose failure stays an alert until a later run succeeds
var operationAlerts = map[string]struct {
	title    string
	severity Severity
}{
	"pool.apply":            {"The last pool change", Critical},
	"integrity.scrub":       {"The last copy verification", Critical},
	"integrity.smart-short": {"The last short self-test", Critical},
	"integrity.smart-long":  {"The last long self-test", Critical},
	"cleanup.journal":       {"The last journal retention change", Warning},
}

func Evaluate(in Inputs) []Condition {
	labels := map[string]string{}
	for _, device := range in.Devices {
		labels[device.ID] = label(device)
	}
	latest := latestByKind(in.Operations)
	conditions := memberConditions(in.Pool, labels)
	conditions = append(conditions, healthConditions(in.Devices, labels)...)
	conditions = append(conditions, usageConditions(in.Pool, in.Desired.Alerts)...)
	conditions = append(conditions, fillingConditions(in.FullInDays)...)
	conditions = append(conditions, driftConditions(in, latest)...)
	conditions = append(conditions, operationConditions(latest)...)
	conditions = append(conditions, deploymentConditions(in.Deployment)...)
	if len(in.Desired.Backups.Targets) == 0 {
		conditions = append(conditions, Condition{Key: "backup.none", Severity: Warning,
			Summary: "No backup target is configured. Two copies survive a failed disk, not deletion or losing the host."})
	}
	return conditions
}

// deploymentConditions report a merged main that did not reach production
func deploymentConditions(state *deployment.State) []Condition {
	if state == nil {
		return nil
	}
	revision, active := shortRevision(state.Revision()), shortRevision(state.ActiveCommit)
	switch state.Phase {
	case deployment.Failed:
		return []Condition{{Key: "deploy.failed", Severity: Warning,
			Summary: fmt.Sprintf("Automatic deployment of %s failed: %s Production still runs %s.", revision, state.Error, active)}}
	case deployment.Halted:
		return []Condition{{Key: "deploy.halted", Severity: Critical,
			Summary: fmt.Sprintf("Automatic deployment of %s stopped: %s Inspect the host, then resume automatic deployment.", revision, state.Error)}}
	}
	return nil
}

func shortRevision(revision string) string {
	return revision[:min(len(revision), 7)]
}

func memberConditions(pool host.Pool, labels map[string]string) []Condition {
	conditions := []Condition{}
	for _, member := range pool.Members {
		devid := strconv.FormatInt(member.DevID, 10)
		name := labels[member.DeviceID]
		if name == "" {
			name = "Device " + devid
		}
		if member.Missing {
			conditions = append(conditions, Condition{Key: "pool.missing." + devid, Severity: Critical,
				Summary: name + " is missing from the pool; data relies on the remaining copies."})
		}
		if total := member.Errors.Total(); total > 0 {
			conditions = append(conditions, Condition{Key: "device.errors." + devid, Severity: Critical,
				Summary: fmt.Sprintf("%s recorded %d read, write or checksum errors.", name, total)})
		}
	}
	return conditions
}

// healthConditions covers the disks whose failure matters: pool members and backup targets
func healthConditions(devices []host.Device, labels map[string]string) []Condition {
	conditions := []Condition{}
	for _, device := range devices {
		if device.Health == nil || device.Class != host.ClassPool && device.Class != host.ClassBackup {
			continue
		}
		switch device.Health.State {
		case host.HealthFailed:
			conditions = append(conditions, Condition{Key: "device.smart." + device.ID, Severity: Critical,
				Summary: labels[device.ID] + " failed its SMART self-assessment; replace it."})
		case host.HealthWarning:
			conditions = append(conditions, Condition{Key: "device.smart." + device.ID, Severity: Warning,
				Summary: labels[device.ID] + " reports reallocated, pending or unreadable sectors."})
		}
	}
	return conditions
}

func usageConditions(pool host.Pool, thresholds state.Alerts) []Condition {
	percent, ok := usedPercent(pool)
	summary := fmt.Sprintf("The pool is %d%% full.", percent)
	switch {
	case !ok:
		return nil
	case percent >= thresholds.PoolCriticalPercent:
		return []Condition{{Key: "pool.usage", Severity: Critical, Summary: summary}}
	case percent >= thresholds.PoolWarningPercent:
		return []Condition{{Key: "pool.usage", Severity: Warning, Summary: summary}}
	default:
		return nil
	}
}

// fillingConditions warns ahead of a full pool, while there is still time to add a disk
func fillingConditions(days *float64) []Condition {
	switch {
	case days == nil || *days >= 30:
		return nil
	case *days < 7:
		return []Condition{{Key: "pool.filling", Severity: Critical, Summary: fmt.Sprintf("At last week's growth the pool is full in %.0f days.", *days)}}
	default:
		return []Condition{{Key: "pool.filling", Severity: Warning, Summary: fmt.Sprintf("At last week's growth the pool is full in %.0f days.", *days)}}
	}
}

// driftConditions stays quiet while a pool change runs: that change is the convergence itself
func driftConditions(in Inputs, latest map[string]operation.Operation) []Condition {
	if change, found := latest["pool.apply"]; found && !change.State.Finished() {
		return nil
	}
	if len(in.Drift.Steps) == 0 && len(in.Drift.Issues) == 0 && len(in.Pool.DataProfiles) <= 1 && len(in.Pool.MetadataProfiles) <= 1 {
		return nil
	}
	return []Condition{{Key: "pool.drift", Severity: Warning, Summary: "The pool differs from its desired state; review it in Regado."}}
}

func operationConditions(latest map[string]operation.Operation) []Condition {
	conditions := []Condition{}
	for _, kind := range slices.Sorted(maps.Keys(operationAlerts)) {
		if last, ok := latest[kind]; ok && last.State == operation.Failed {
			conditions = append(conditions, Condition{Key: "operation." + kind, Severity: operationAlerts[kind].severity,
				Summary: operationAlerts[kind].title + " failed: " + last.Error})
		}
	}
	return conditions
}

// usedPercent is stored data against the space it can still grow into, as Regado shows it
func usedPercent(pool host.Pool) (int, bool) {
	ratio := pool.DataRatio
	if ratio <= 0 {
		ratio = 1
	}
	stored := float64(pool.Used) / ratio
	total := stored + float64(max(0, pool.FreeEstimated))
	if total <= 0 {
		return 0, false
	}
	return int(stored / total * 100), true
}

// latestByKind keeps each kind's newest finished run; interrupted and cancelled runs say nothing
func latestByKind(operations []operation.Operation) map[string]operation.Operation {
	latest := map[string]operation.Operation{}
	for _, item := range operations {
		if _, seen := latest[item.Kind]; seen || item.State == operation.Interrupted || item.State == operation.Cancelled {
			continue
		}
		latest[item.Kind] = item
	}
	return latest
}

func label(device host.Device) string {
	switch {
	case device.Model != "" && device.Serial != "":
		return device.Model + " (" + device.Serial + ")"
	case device.Serial != "":
		return device.Serial
	default:
		return device.ID
	}
}
