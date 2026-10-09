// Package storage plans and performs changes to the host's Btrfs pool.
package storage

// Compares the desired pool with the actual one and orders the safe steps between them
import (
	"fmt"
	"maps"
	"slices"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
)

type StepKind string

const (
	StepReplace StepKind = "replace"
	StepAdd     StepKind = "add"
	StepConvert StepKind = "convert"
	StepRemove  StepKind = "remove"
)

// minimumDeviceSize keeps tiny devices such as card readers out of the pool
const minimumDeviceSize = 8 << 30

type Step struct {
	Kind StepKind `json:"kind"`
	// Device is the device being added, the replacement, or the device being removed.
	Device string `json:"device,omitempty"`
	// Replaces is the missing member's devid when a replacement takes its place.
	Replaces int64  `json:"replaces,omitempty"`
	Data     string `json:"data,omitempty"`
	Metadata string `json:"metadata,omitempty"`
	Summary  string `json:"summary"`
	// Confirm is the serial the operator must type before existing data on Device is erased.
	Confirm string `json:"confirm,omitempty"`
}

type Plan struct {
	Steps  []Step   `json:"steps"`
	Issues []string `json:"issues"`
}

// Ready reports whether the plan can be applied.
func (plan Plan) Ready() bool { return len(plan.Issues) == 0 }

// MetadataProfile resolves "auto" for a pool of the given size.
func MetadataProfile(configured string, devices int) string {
	if configured != "auto" {
		return configured
	}
	switch {
	case devices >= 3:
		return "raid1c3"
	case devices == 2:
		return "raid1"
	default:
		return "dup"
	}
}

// PlanPool orders replacements, additions, profile conversion and removals.
// Conversion runs before removal so the remaining devices always satisfy the profiles.
func PlanPool(desired state.Pool, devices []host.Device, pool host.Pool) Plan {
	planner := newPlanner(desired, devices, pool)
	additions, absent := planner.splitDesired()
	// Desired but disconnected devices account for missing members; extra ones were never in the pool
	for _, id := range absent[min(len(absent), len(planner.missing)):] {
		planner.issue("%s is not connected to this host.", id)
	}
	// Missing members the operator dropped are rebuilt onto additions, or removed
	unexplained := planner.missing[min(len(absent), len(planner.missing)):]
	unexplained = planner.addDevices(additions, unexplained)
	if len(absent) == 0 {
		planner.convertProfiles()
	}
	planner.removeDevices(unexplained)
	slices.SortStableFunc(planner.plan.Steps, func(a, b Step) int { return order(a.Kind) - order(b.Kind) })
	return planner.plan
}

type planner struct {
	desired state.Pool
	pool    host.Pool
	byID    map[string]host.Device
	present map[string]host.Member
	missing []host.Member
	plan    Plan
}

func newPlanner(desired state.Pool, devices []host.Device, pool host.Pool) *planner {
	planner := &planner{desired: desired, pool: pool, byID: map[string]host.Device{}, present: map[string]host.Member{},
		plan: Plan{Steps: []Step{}, Issues: []string{}}}
	for _, device := range devices {
		planner.byID[device.ID] = device
	}
	for _, member := range pool.Members {
		if member.Missing {
			planner.missing = append(planner.missing, member)
		} else if member.DeviceID != "" {
			planner.present[member.DeviceID] = member
		}
	}
	slices.SortFunc(planner.missing, func(a, b host.Member) int { return int(a.DevID - b.DevID) })
	return planner
}

func (planner *planner) issue(format string, args ...any) {
	planner.plan.Issues = append(planner.plan.Issues, fmt.Sprintf(format, args...))
}

// splitDesired separates desired devices to add from desired devices that are not connected
func (planner *planner) splitDesired() (additions, absent []string) {
	for _, id := range planner.desired.Devices {
		if _, isMember := planner.present[id]; isMember {
			continue
		}
		if _, connected := planner.byID[id]; connected {
			additions = append(additions, id)
		} else {
			absent = append(absent, id)
		}
	}
	return additions, absent
}

// addDevices plans additions, turning each into a replacement while dropped missing members remain
func (planner *planner) addDevices(additions []string, unexplained []host.Member) []host.Member {
	for _, id := range additions {
		device := planner.byID[id]
		if issue := additionIssue(device); issue != "" {
			planner.plan.Issues = append(planner.plan.Issues, issue)
			continue
		}
		step := Step{Kind: StepAdd, Device: id, Summary: fmt.Sprintf("Add %s to the pool", describe(device))}
		if device.Class != host.ClassBlank {
			step.Confirm = device.Serial
			step.Summary = fmt.Sprintf("Erase %s and add it to the pool", describe(device))
		}
		if len(unexplained) > 0 {
			step.Kind, step.Replaces = StepReplace, unexplained[0].DevID
			step.Summary = fmt.Sprintf("Rebuild missing device %d onto %s", unexplained[0].DevID, describe(device))
			unexplained = unexplained[1:]
		}
		planner.plan.Steps = append(planner.plan.Steps, step)
	}
	return unexplained
}

func (planner *planner) convertProfiles() {
	data := planner.desired.DataProfile
	metadata := MetadataProfile(planner.desired.MetadataProfile, len(planner.desired.Devices))
	if matches(planner.pool.DataProfiles, data) && matches(planner.pool.MetadataProfiles, metadata) {
		return
	}
	planner.plan.Steps = append(planner.plan.Steps, Step{Kind: StepConvert, Data: data, Metadata: metadata,
		Summary: fmt.Sprintf("Store data as %s and metadata as %s", data, metadata)})
}

// removeDevices plans removals of undesired members and of dropped missing members
func (planner *planner) removeDevices(unexplained []host.Member) {
	var removed int64
	for _, id := range slices.Sorted(maps.Keys(planner.present)) {
		if slices.Contains(planner.desired.Devices, id) {
			continue
		}
		device := planner.byID[id]
		if device.HostsSystem {
			planner.issue("%s also holds the operating system and cannot leave the pool.", describe(device))
			continue
		}
		removed += planner.present[id].Size
		planner.plan.Steps = append(planner.plan.Steps, Step{Kind: StepRemove, Device: id, Summary: fmt.Sprintf("Move data off %s and remove it", describe(device))})
	}
	for _, member := range unexplained {
		planner.plan.Steps = append(planner.plan.Steps, Step{Kind: StepRemove, Replaces: member.DevID,
			Summary: fmt.Sprintf("Drop missing device %d and restore copies on the remaining devices", member.DevID)})
	}
	if pool := planner.pool; removed > 0 && pool.Allocated > 0 && pool.DeviceSize-removed < pool.Allocated+pool.Allocated/10 {
		planner.issue("The remaining devices cannot hold the stored data with its copies.")
	}
}

func additionIssue(device host.Device) string {
	switch {
	case device.HostsSystem:
		return fmt.Sprintf("%s holds the operating system outside the pool and cannot be erased.", describe(device))
	case len(device.Mountpoints) > 0 || slices.ContainsFunc(device.Partitions, func(part host.Partition) bool { return len(part.Mountpoints) > 0 }):
		return fmt.Sprintf("%s is mounted. Unmount it before adding it to the pool.", describe(device))
	case device.Size < minimumDeviceSize:
		return fmt.Sprintf("%s is smaller than 8 GiB.", describe(device))
	case device.Class == host.ClassUnidentified:
		return fmt.Sprintf("%s has no stable identity.", device.Path)
	case device.Class != host.ClassBlank && device.Serial == "":
		return fmt.Sprintf("%s has data but no serial number to confirm erasing it.", describe(device))
	}
	return ""
}

func matches(actual []string, wanted string) bool {
	return len(actual) == 1 && actual[0] == wanted
}

func order(kind StepKind) int {
	return slices.Index([]StepKind{StepReplace, StepAdd, StepConvert, StepRemove}, kind)
}

func describe(device host.Device) string {
	switch {
	case device.Model != "" && device.Serial != "":
		return fmt.Sprintf("%s (%s)", device.Model, device.Serial)
	case device.ID != "":
		return device.ID
	default:
		return device.Path
	}
}
