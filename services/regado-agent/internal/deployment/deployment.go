// Package deployment queues verified release attempts and reconciles their durable progress with systemd.
package deployment

// Owns idempotent deployment requests, bounded history and interrupted-unit failure reporting
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
)

const DefaultDirectory = "/var/lib/kaordo-deploy"
const (
	Waiting    = "waiting"
	Deploying  = "deploying"
	Succeeded  = "succeeded"
	Superseded = "superseded"
	Failed     = "failed"
)

var (
	ErrUnknownRun    = errors.New("this run has not been deployed")
	ErrInvalid       = errors.New("a valid GitHub Actions run, attempt and revision are required")
	ErrAttemptActive = errors.New("a previous attempt is still running; wait for its result before retrying")
	revisionPattern  = regexp.MustCompile(`^[a-f0-9]{40}$`)
	activeStates     = []string{"active", "activating", "deactivating"}
)

type Request struct {
	Run      int64  `json:"run"`
	Attempt  int    `json:"attempt"`
	Revision string `json:"revision"`
}

type Event struct {
	Sequence int64     `json:"sequence"`
	At       time.Time `json:"at"`
	Phase    string    `json:"phase"`
	Level    string    `json:"level"`
	Message  string    `json:"message"`
}

type Progress struct {
	ReceivedBytes int64 `json:"receivedBytes"`
	TotalBytes    int64 `json:"totalBytes"`
}

type Failure struct {
	Phase   string `json:"phase"`
	Message string `json:"message"`
}

// Record survives API and agent restarts; its event window is maintained by the installer.
type Record struct {
	Run             int64      `json:"run"`
	Attempt         int        `json:"attempt,omitempty"`
	Revision        string     `json:"revision,omitempty"`
	State           string     `json:"state"`
	Phase           string     `json:"phase,omitempty"`
	Message         string     `json:"message,omitempty"`
	Release         string     `json:"release,omitempty"`
	PreviousRelease string     `json:"previousRelease,omitempty"`
	Progress        *Progress  `json:"progress,omitempty"`
	Error           *Failure   `json:"error,omitempty"`
	Rollback        string     `json:"rollback,omitempty"`
	RollbackFailed  bool       `json:"rollbackFailed,omitempty"`
	HostChanged     bool       `json:"hostChanged,omitempty"`
	StartedAt       time.Time  `json:"startedAt,omitzero"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	FinishedAt      *time.Time `json:"finishedAt,omitempty"`
	Events          []Event    `json:"events,omitempty"`
}

func (record Record) final() bool {
	return record.State == Succeeded || record.State == Superseded || record.State == Failed
}

type Deployments struct {
	Run       command.Runner
	Directory string
	mu        sync.Mutex
}

func unit(run int64, attempt int) string {
	if attempt == 0 {
		return fmt.Sprintf("kaordo-deploy@%d.service", run)
	}
	return fmt.Sprintf("kaordo-deploy@%d-%d.service", run, attempt)
}

// Start accepts each authenticated attempt once, even if the HTTP response was lost.
func (deployments *Deployments) Start(ctx context.Context, request Request) (Record, error) {
	if request.Run < 1 || request.Attempt < 1 || !revisionPattern.MatchString(request.Revision) {
		return Record{}, ErrInvalid
	}
	deployments.mu.Lock()
	defer deployments.mu.Unlock()
	previous, found, err := deployments.record(request.Run)
	if err != nil {
		return Record{}, err
	}
	if found {
		if previous.Attempt >= request.Attempt {
			return deployments.status(ctx, request.Run)
		}
		previous, err = deployments.status(ctx, request.Run)
		if err != nil {
			return Record{}, err
		}
		if !previous.final() {
			return Record{}, ErrAttemptActive
		}
		state, err := deployments.inspect(ctx, previous)
		if err != nil {
			return Record{}, err
		}
		if slices.Contains(activeStates, state["ActiveState"]) {
			return Record{}, ErrAttemptActive
		}
	}
	now := time.Now().UTC()
	record := Record{Run: request.Run, Attempt: request.Attempt, Revision: request.Revision,
		State: Waiting, Phase: "queued", Message: "Waiting for the deployment lock.",
		StartedAt: now, UpdatedAt: now, Rollback: "not_needed",
		Events: []Event{{Sequence: 1, At: now, Phase: "queued", Level: "info", Message: "Deployment accepted."}}}
	if err := deployments.write(record); err != nil {
		return Record{}, err
	}
	return deployments.dispatch(ctx, record)
}

// dispatch confirms acceptance without letting an HTTP disconnect cancel the systemd job.
func (deployments *Deployments) dispatch(ctx context.Context, record Record) (Record, error) {
	// Acceptance owns the job; a disconnected HTTP caller must not cancel its dispatch
	startCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if _, err := deployments.Run(startCtx, "systemctl", "start", "--no-block", unit(record.Run, record.Attempt)); err != nil {
		inspectCtx, stop := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer stop()
		state, inspectErr := deployments.inspect(inspectCtx, record)
		if inspectErr != nil {
			return Record{}, fmt.Errorf("accepted deployment dispatch could not be confirmed: %w", errors.Join(err, inspectErr))
		}
		if slices.Contains(activeStates, state["ActiveState"]) {
			return record, nil
		}
		record.State, record.Message = Failed, "systemd could not start the deployment: "+err.Error()
		record.Error = &Failure{Phase: record.Phase, Message: record.Message}
		now := time.Now().UTC()
		record.UpdatedAt = now
		record.FinishedAt = &now
		record.Events = append(record.Events, Event{Sequence: 2, At: now, Phase: record.Phase, Level: "error", Message: record.Message})
		if saveErr := deployments.write(record); saveErr != nil {
			return Record{}, saveErr
		}
	}
	return record, nil
}

func (deployments *Deployments) Status(ctx context.Context, run int64) (Record, error) {
	deployments.mu.Lock()
	defer deployments.mu.Unlock()
	return deployments.status(ctx, run)
}

func (deployments *Deployments) inspect(ctx context.Context, record Record) (map[string]string, error) {
	output, err := deployments.Run(ctx, "systemctl", "show", "--property=ActiveState,Result,ExecMainStatus", unit(record.Run, record.Attempt))
	if err != nil {
		return nil, fmt.Errorf("inspect deployment unit: %w", err)
	}
	values := map[string]string{}
	for line := range strings.SplitSeq(strings.TrimSpace(output), "\n") {
		if key, value, ok := strings.Cut(line, "="); ok {
			values[key] = value
		}
	}
	return values, nil
}

func (deployments *Deployments) status(ctx context.Context, run int64) (Record, error) {
	record, found, err := deployments.record(run)
	if err != nil {
		return Record{}, err
	}
	if !found {
		return Record{}, ErrUnknownRun
	}
	if record.final() {
		return record, nil
	}
	state, err := deployments.inspect(ctx, record)
	if err != nil {
		return Record{}, err
	}
	if slices.Contains(activeStates, state["ActiveState"]) ||
		(record.State == Waiting && state["ActiveState"] == "inactive" && time.Since(record.UpdatedAt) < 10*time.Second) {
		return record, nil
	}

	// Power loss, OOM or a systemd deadline cannot leave a permanent "deploying" record
	now := time.Now().UTC()
	record.State, record.UpdatedAt, record.FinishedAt = Failed, now, &now
	record.Message = fmt.Sprintf("Deployment stopped during %s (systemd result: %s, exit status: %s).", record.Phase, state["Result"], state["ExecMainStatus"])
	if record.Error == nil {
		record.Error = &Failure{Phase: record.Phase, Message: record.Message}
	}
	if record.HostChanged && record.Rollback != "succeeded" {
		record.Rollback, record.RollbackFailed = "failed", true
		record.Message += " Installation or rollback was interrupted; inspect production before retrying."
	}
	sequence := int64(1)
	if len(record.Events) > 0 {
		sequence = record.Events[len(record.Events)-1].Sequence + 1
	}
	record.Events = append(record.Events, Event{Sequence: sequence, At: now, Phase: record.Phase, Level: "error", Message: record.Message})
	if err := deployments.write(record); err != nil {
		return Record{}, err
	}
	return record, nil
}

func (deployments *Deployments) runs() ([]int64, error) {
	entries, err := os.ReadDir(deployments.Directory)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("list deployments: %w", err)
	}
	runs := []int64{}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		if run, err := strconv.ParseInt(strings.TrimSuffix(entry.Name(), ".json"), 10, 64); err == nil && run > 0 {
			runs = append(runs, run)
		}
	}
	slices.SortFunc(runs, func(a, b int64) int {
		if a > b {
			return -1
		}
		if a < b {
			return 1
		}
		return 0
	})
	return runs, nil
}

func (deployments *Deployments) Latest(ctx context.Context) (*Record, error) {
	runs, err := deployments.runs()
	if err != nil || len(runs) == 0 {
		return nil, err
	}
	record, err := deployments.Status(ctx, runs[0])
	return &record, err
}

// List omits journals; the administrator loads the selected run's detailed record separately.
func (deployments *Deployments) List(ctx context.Context) ([]Record, error) {
	runs, err := deployments.runs()
	if err != nil {
		return nil, err
	}
	items := []Record{}
	for _, run := range runs[:min(len(runs), 20)] {
		record, err := deployments.Status(ctx, run)
		if err != nil {
			return nil, err
		}
		record.Events = nil
		items = append(items, record)
	}
	return items, nil
}

func (deployments *Deployments) record(run int64) (Record, bool, error) {
	root, err := os.OpenRoot(deployments.Directory)
	if errors.Is(err, fs.ErrNotExist) {
		return Record{}, false, nil
	}
	if err != nil {
		return Record{}, false, fmt.Errorf("open deployments: %w", err)
	}
	raw, err := root.ReadFile(strconv.FormatInt(run, 10) + ".json")
	_ = root.Close()
	if errors.Is(err, fs.ErrNotExist) {
		return Record{}, false, nil
	}
	if err != nil {
		return Record{}, false, fmt.Errorf("read deployment %d: %w", run, err)
	}
	var record Record
	if err := json.Unmarshal(raw, &record); err != nil {
		return Record{}, false, fmt.Errorf("decode deployment %d: %w", run, err)
	}
	return record, true, nil
}

func (deployments *Deployments) write(record Record) error {
	if err := os.MkdirAll(deployments.Directory, 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(deployments.Directory)
	if err != nil {
		return err
	}
	defer func() { _ = root.Close() }()
	name := strconv.FormatInt(record.Run, 10) + ".json"
	file, err := root.OpenFile(name+".new", os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(append(data, '\n')); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := root.Rename(name+".new", name); err != nil {
		return err
	}
	parent, err := root.Open(".")
	if err != nil {
		return err
	}
	return errors.Join(parent.Sync(), parent.Close())
}
