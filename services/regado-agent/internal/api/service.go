// Package api exposes the host's desired state, facts and operations over the agent socket.
package api

// Coordinates facts, plans, desired state writes and the operations that converge the host
import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"reflect"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/alert"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/integrity"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/journal"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/storage"
)

// AgentRequester marks operations the agent starts itself to converge the host.
const AgentRequester = "agent"

var (
	ErrBusy        = errors.New("another pool change is still running")
	ErrNotReady    = errors.New("the desired state cannot be applied")
	ErrUnconfirmed = errors.New("erasing a device needs its serial number")
	ErrIncomplete  = errors.New("a reason and the requesting account are required")
)

// Host describes the machine the agent manages.
type Host struct {
	Name      string `json:"name"`
	MachineID string `json:"machineId"`
	Firmware  string `json:"firmware"`
	PoolMount string `json:"poolMount"`
}

// Facts is what Regado shows: the actual host, the desired state and what it would take to converge.
type Facts struct {
	Host    Host           `json:"host"`
	Devices []host.Device  `json:"devices"`
	Pool    host.Pool      `json:"pool"`
	Desired state.Document `json:"desired"`
	Drift   storage.Plan   `json:"drift"`
}

type Change struct {
	Document      state.Document `json:"document"`
	Confirmations []string       `json:"confirmations"`
	Reason        string         `json:"reason"`
	RequestedBy   string         `json:"requestedBy"`
	// Converge starts pool steps even when the pool section is unchanged, to finish drift
	Converge bool `json:"converge"`
}

type ChangeResult struct {
	Document  state.Document       `json:"document"`
	Previous  *state.Document      `json:"previous"`
	Operation *operation.Operation `json:"operation"`
}

type Service struct {
	Run        command.Runner
	Host       Host
	Inventory  host.Options
	States     *state.Store
	Operations *operation.Manager
	Executor   storage.Executor
	Integrity  integrity.Checker
	Journal    journal.Policy
	Alerts     *alert.Tracker
	Health     host.HealthMonitor

	// mu serializes plans with the writes that act on them
	mu sync.Mutex
}

// Adopt records the current pool as the desired state the first time the agent runs, so a
// freshly installed agent never plans changes to a working host.
func (service *Service) Adopt(ctx context.Context) error {
	service.mu.Lock()
	defer service.mu.Unlock()
	if _, err := service.States.Current(); !errors.Is(err, state.ErrNotFound) {
		return err
	}
	_, pool, err := service.facts(ctx)
	if err != nil {
		return err
	}
	members := []string{}
	for _, member := range pool.Members {
		if member.DeviceID != "" && !member.Missing {
			members = append(members, member.DeviceID)
		}
	}
	slices.Sort(members)
	if len(members) == 0 {
		return fmt.Errorf("no pool device on %s has a stable identity", service.Host.PoolMount)
	}
	document := state.Default(members)
	if len(pool.DataProfiles) == 1 {
		document.Pool.DataProfile = pool.DataProfiles[0]
	}
	if len(pool.MetadataProfiles) == 1 && pool.MetadataProfiles[0] != storage.MetadataProfile("auto", len(members)) {
		document.Pool.MetadataProfile = pool.MetadataProfiles[0]
	}
	// Keep the retention an administrator already chose for the journal
	if days := service.Journal.Status(ctx, service.Run).RetentionDays; days != nil && journal.ValidDays(*days) {
		document.Cleanup.JournalDays = *days
	}
	_, _, err = service.States.Put(document)
	return err
}

func (service *Service) facts(ctx context.Context) ([]host.Device, host.Pool, error) {
	pool, err := host.ReadPool(ctx, service.Run, service.Host.PoolMount, nil)
	if err != nil {
		return nil, host.Pool{}, err
	}
	devices, err := host.Inventory(ctx, service.Run, pool.UUID, service.Inventory)
	if err != nil {
		return nil, host.Pool{}, err
	}
	pool, err = host.ReadPool(ctx, service.Run, service.Host.PoolMount, devices)
	return devices, pool, err
}

// Facts reads the host and compares it with the desired state.
func (service *Service) Facts(ctx context.Context) (Facts, error) {
	devices, pool, err := service.facts(ctx)
	if err != nil {
		return Facts{}, err
	}
	desired, err := service.States.Current()
	if err != nil {
		return Facts{}, err
	}
	for index := range devices {
		devices[index].Health = service.Health.Lookup(devices[index].ID)
	}
	return Facts{Host: service.Host, Devices: devices, Pool: pool, Desired: desired, Drift: storage.PlanPool(desired.Pool, devices, pool)}, nil
}

// WatchHealth refreshes SMART reports until ctx ends, so fact reads never wait on smartctl.
func (service *Service) WatchHealth(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		devices, err := host.Inventory(ctx, service.Run, "", service.Inventory)
		if err == nil {
			service.Health.Refresh(ctx, service.Run, devices, time.Now)
		} else if ctx.Err() == nil {
			slog.Warn("device inventory for health checks failed", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Plan previews the steps a document would start without storing it.
func (service *Service) Plan(ctx context.Context, document state.Document) (storage.Plan, error) {
	if err := document.Validate(); err != nil {
		return storage.Plan{}, err
	}
	devices, pool, err := service.facts(ctx)
	if err != nil {
		return storage.Plan{}, err
	}
	return storage.PlanPool(document.Pool, devices, pool), nil
}

// Apply stores the document and starts one operation for its pool steps. Settings outside the
// pool are stored without touching disks, so they never wait on or trigger pool work.
func (service *Service) Apply(ctx context.Context, change Change) (ChangeResult, error) {
	if strings.TrimSpace(change.Reason) == "" || change.RequestedBy == "" {
		return ChangeResult{}, ErrIncomplete
	}
	if err := change.Document.Validate(); err != nil {
		return ChangeResult{}, err
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	current, err := service.States.Current()
	if err != nil {
		return ChangeResult{}, err
	}
	if !change.Converge && reflect.DeepEqual(current.Pool, change.Document.Pool) {
		stored, previous, err := service.States.Put(change.Document)
		if err != nil {
			return ChangeResult{}, err
		}
		started, err := service.applySettings(previous, stored, change)
		return ChangeResult{Document: stored, Previous: previous, Operation: started}, err
	}
	devices, pool, err := service.facts(ctx)
	if err != nil {
		return ChangeResult{}, err
	}
	plan := storage.PlanPool(change.Document.Pool, devices, pool)
	if !plan.Ready() {
		return ChangeResult{}, fmt.Errorf("%w: %s", ErrNotReady, strings.Join(plan.Issues, " "))
	}
	for _, step := range plan.Steps {
		if step.Confirm != "" && !slices.Contains(change.Confirmations, step.Confirm) {
			return ChangeResult{}, fmt.Errorf("%w: type %s to erase %s", ErrUnconfirmed, step.Confirm, step.Device)
		}
	}
	if len(plan.Steps) > 0 && service.poolChangeActive() {
		return ChangeResult{}, ErrBusy
	}
	stored, previous, err := service.States.Put(change.Document)
	if err != nil {
		return ChangeResult{}, err
	}
	result := ChangeResult{Document: stored, Previous: previous}
	settings, err := service.applySettings(previous, stored, change)
	if err != nil {
		return result, err
	}
	if len(plan.Steps) == 0 {
		result.Operation = settings
		return result, nil
	}
	started, err := service.Operations.Start(operation.Request{
		Kind: "pool.apply", Target: fmt.Sprintf("revision %d", stored.Revision), Reason: change.Reason,
		RequestedBy: change.RequestedBy, Exclusive: true, Cancellable: true, Stages: storage.Stages(plan),
		Run: func(ctx context.Context, job *operation.Job) error {
			return service.Executor.Apply(ctx, job, plan, devices)
		},
	})
	if err != nil {
		return result, err
	}
	result.Operation = &started
	return result, nil
}

// applySettings starts the work that makes changed settings outside the pool take effect
func (service *Service) applySettings(previous *state.Document, stored state.Document, change Change) (*operation.Operation, error) {
	if previous != nil && previous.Cleanup.JournalDays == stored.Cleanup.JournalDays {
		return nil, nil
	}
	started, err := service.Operations.Start(service.journalRequest(stored.Cleanup.JournalDays, change.RequestedBy, change.Reason))
	if err != nil {
		return nil, err
	}
	return &started, nil
}

func (service *Service) journalRequest(days int, requestedBy, reason string) operation.Request {
	return operation.Request{
		Kind: "cleanup.journal", Target: journalTarget(days), Reason: reason, RequestedBy: requestedBy,
		Stages: []string{"Apply journal retention"},
		Run: func(ctx context.Context, job *operation.Job) error {
			job.Stage(0)
			status, err := service.Journal.Apply(ctx, service.Run, days)
			if err != nil {
				return err
			}
			if status.Warning != "" {
				job.Logf("%s", status.Warning)
			}
			job.Logf("The journal keeps %s", journalTarget(days))
			return nil
		},
	}
}

func journalTarget(days int) string {
	if days == 0 {
		return "history within the size budget"
	}
	return fmt.Sprintf("%d days of history", days)
}

// ReconcileJournal applies the desired retention when journald reports another one, as after
// a reinstall that restored the default policy file.
func (service *Service) ReconcileJournal(ctx context.Context) error {
	desired, err := service.States.Current()
	if err != nil {
		return err
	}
	status := service.Journal.Status(ctx, service.Run)
	if !status.Managed || status.RetentionDays != nil && *status.RetentionDays == desired.Cleanup.JournalDays {
		return nil
	}
	_, err = service.Operations.Start(service.journalRequest(desired.Cleanup.JournalDays, AgentRequester,
		"The journal retention differed from the desired state"))
	return err
}

func (service *Service) poolChangeActive() bool {
	operations, err := service.Operations.List(20)
	if err != nil {
		return true
	}
	return slices.ContainsFunc(operations, func(item operation.Operation) bool {
		return item.Kind == "pool.apply" && !item.State.Finished()
	})
}

// DescribeHost reads the host identity and firmware mode.
func DescribeHost(poolMount string) Host {
	name, _ := os.Hostname()
	machineID, _ := os.ReadFile("/etc/machine-id")
	firmware := "bios"
	if _, err := os.Stat("/sys/firmware/efi"); err == nil {
		firmware = "efi"
	}
	return Host{Name: name, MachineID: strings.TrimSpace(string(machineID)), Firmware: firmware, PoolMount: poolMount}
}
