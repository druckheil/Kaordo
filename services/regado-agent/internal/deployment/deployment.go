// Package deployment reads what the host's automatic deployment last recorded.
package deployment

// Reads the pull controller's state file; only the controller writes it
import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
)

// DefaultDirectory is where deploy/nixos/cd.mjs keeps its state.
const DefaultDirectory = "/var/lib/kaordo-cd"

// Phases that need an operator: a failed attempt left the previous release running; a halted
// one may have left production inconsistent and stops further deployments
const (
	Failed = "failed"
	Halted = "halted"
)

type State struct {
	Phase        string `json:"phase"`
	ActiveCommit string `json:"activeCommit"`
	// FailedAttempt is "<revision>:<run>:<attempt>" of the attempt that failed or halted
	FailedAttempt string `json:"failedAttempt"`
	Error         string `json:"error"`
}

// Read returns nil when the host has no automatic deployment.
func Read(directory string) (*State, error) {
	root, err := os.OpenRoot(directory)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("open deployment state: %w", err)
	}
	raw, err := root.ReadFile("state.json")
	_ = root.Close() // read-only; the contents decide
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read deployment state: %w", err)
	}
	var state State
	if err := json.Unmarshal(raw, &state); err != nil {
		return nil, fmt.Errorf("decode deployment state: %w", err)
	}
	return &state, nil
}

// Revision is the commit of the attempt that failed or halted.
func (state State) Revision() string {
	revision, _, _ := strings.Cut(state.FailedAttempt, ":")
	return revision
}
