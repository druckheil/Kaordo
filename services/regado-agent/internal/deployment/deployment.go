// Package deployment starts production deployments of GitHub Actions builds and reports them.
package deployment

// Starts one systemd unit per Actions run and reads the record that unit keeps for the run
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
)

// DefaultDirectory is where deploy/nixos/deploy.mjs records each run.
const DefaultDirectory = "/var/lib/kaordo-deploy"

// States a deployment reports; succeeded, superseded and failed are final
const (
	Waiting    = "waiting"
	Deploying  = "deploying"
	Succeeded  = "succeeded"
	Superseded = "superseded"
	Failed     = "failed"
)

var ErrUnknownRun = errors.New("this run has not been deployed")

// Record is the last state a run's deployment reported.
type Record struct {
	Run      int64  `json:"run"`
	Revision string `json:"revision,omitempty"`
	State    string `json:"state"`
	Message  string `json:"message,omitempty"`
	// RollbackFailed marks a failed release whose rollback left production possibly inconsistent
	RollbackFailed bool      `json:"rollbackFailed,omitempty"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

func (record Record) final() bool {
	return record.State == Succeeded || record.State == Superseded || record.State == Failed
}

type Deployments struct {
	Run       command.Runner
	Directory string
}

func unit(run int64) string { return fmt.Sprintf("kaordo-deploy@%d.service", run) }

// Start deploys run; a run that is already deploying continues, a finished one deploys again.
func (deployments Deployments) Start(ctx context.Context, run int64) (Record, error) {
	if _, err := deployments.Run(ctx, "systemctl", "start", unit(run)); err != nil {
		return Record{}, fmt.Errorf("start %s: %w", unit(run), err)
	}
	return deployments.Status(ctx, run)
}

// Status reports run. While its unit runs, an earlier attempt's final record is not the answer:
// the run is waiting for another deployment or deploying.
func (deployments Deployments) Status(ctx context.Context, run int64) (Record, error) {
	record, found, err := deployments.record(run)
	if err != nil {
		return Record{}, err
	}
	active, err := deployments.Run(ctx, "systemctl", "show", "--property=ActiveState", "--value", unit(run))
	if err != nil {
		return Record{}, fmt.Errorf("inspect %s: %w", unit(run), err)
	}
	switch state := strings.TrimSpace(active); {
	case (state == "active" || state == "activating") && (!found || record.final()):
		return Record{Run: run, State: Waiting}, nil
	case found:
		return record, nil
	case state == "failed":
		return Record{Run: run, State: Failed, Message: "The deployment stopped before it reported; see journalctl -u " + unit(run) + "."}, nil
	default:
		return Record{}, ErrUnknownRun
	}
}

// Latest is the newest run's record, or nil before the first deployment.
func (deployments Deployments) Latest() (*Record, error) {
	entries, err := os.ReadDir(deployments.Directory)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("list deployments: %w", err)
	}
	var newest int64
	for _, entry := range entries {
		if run, err := strconv.ParseInt(strings.TrimSuffix(entry.Name(), ".json"), 10, 64); err == nil && run > newest {
			newest = run
		}
	}
	if newest == 0 {
		return nil, nil
	}
	record, _, err := deployments.record(newest)
	return &record, err
}

func (deployments Deployments) record(run int64) (Record, bool, error) {
	root, err := os.OpenRoot(deployments.Directory)
	if errors.Is(err, fs.ErrNotExist) {
		return Record{}, false, nil
	}
	if err != nil {
		return Record{}, false, fmt.Errorf("open deployments: %w", err)
	}
	raw, err := root.ReadFile(strconv.FormatInt(run, 10) + ".json")
	_ = root.Close() // read-only; the contents decide
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
