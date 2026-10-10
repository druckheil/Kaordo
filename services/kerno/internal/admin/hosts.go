package admin

// Authorizes and audits changes to hosts' desired state and operations through their agents
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"reflect"
	"slices"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/invalid"
)

// HostAgent is the outbound port to one host's regado-agent.
type HostAgent interface {
	Host(context.Context) (json.RawMessage, error)
	PlanState(context.Context, json.RawMessage) (json.RawMessage, error)
	ApplyState(context.Context, json.RawMessage) (json.RawMessage, error)
	Operations(context.Context, int) (json.RawMessage, error)
	Operation(context.Context, string) (json.RawMessage, error)
	CancelOperation(context.Context, string) (json.RawMessage, error)
	StartCheck(context.Context, json.RawMessage) (json.RawMessage, error)
	Alerts(ctx context.Context, after int64) (json.RawMessage, error)
	Usage(ctx context.Context, window string) (json.RawMessage, error)
	MeasureUsage(context.Context) (json.RawMessage, error)
	Deploy(ctx context.Context, run int64) (json.RawMessage, error)
	Deployment(ctx context.Context, run int64) (json.RawMessage, error)
}

// AgentError carries an agent's refusal: its HTTP status and operator-facing message.
type AgentError struct {
	Status  int
	Message string
}

func (err *AgentError) Error() string {
	return fmt.Sprintf("agent returned %d: %s", err.Status, err.Message)
}

var ErrUnknownHost = errors.New("unknown host")

// StateChange is an administrator's request to store a new desired state document.
type StateChange struct {
	Document      json.RawMessage `json:"document"`
	Confirmations []string        `json:"confirmations"`
	Reason        string          `json:"reason"`
	Converge      bool            `json:"converge"`
}

// CheckRequest is an administrator's request to run an integrity check now.
type CheckRequest struct {
	Kind   string `json:"kind"`
	Reason string `json:"reason"`
}

// DocumentChange is one changed field in the audit trail of a desired state revision.
type DocumentChange struct {
	Path   string `json:"path"`
	Before any    `json:"before"`
	After  any    `json:"after"`
}

type Hosts struct {
	agents map[string]HostAgent
	audit  AuditRecorder
}

func NewHosts(agents map[string]HostAgent, audit AuditRecorder) *Hosts {
	return &Hosts{agents: agents, audit: audit}
}

// IDs lists registered hosts in a stable order.
func (hosts *Hosts) IDs() []string { return slices.Sorted(maps.Keys(hosts.agents)) }

func (hosts *Hosts) agent(id string) (HostAgent, error) {
	agent, ok := hosts.agents[id]
	if !ok {
		return nil, ErrUnknownHost
	}
	return agent, nil
}

func (hosts *Hosts) Facts(ctx context.Context, id string) (json.RawMessage, error) {
	agent, err := hosts.agent(id)
	if err != nil {
		return nil, err
	}
	return agent.Host(ctx)
}

func (hosts *Hosts) Plan(ctx context.Context, id string, document json.RawMessage) (json.RawMessage, error) {
	agent, err := hosts.agent(id)
	if err != nil {
		return nil, err
	}
	return agent.PlanState(ctx, document)
}

func (hosts *Hosts) Operations(ctx context.Context, id string, limit int) (json.RawMessage, error) {
	agent, err := hosts.agent(id)
	if err != nil {
		return nil, err
	}
	return agent.Operations(ctx, limit)
}

func (hosts *Hosts) Operation(ctx context.Context, id, operation string) (json.RawMessage, error) {
	agent, err := hosts.agent(id)
	if err != nil {
		return nil, err
	}
	return agent.Operation(ctx, operation)
}

// Apply audits the request, forwards it with the actor as requester and audits the resulting diff.
func (hosts *Hosts) Apply(ctx context.Context, actorID, id string, change StateChange) (json.RawMessage, error) {
	agent, err := hosts.agent(id)
	if err != nil {
		return nil, err
	}
	change.Reason = strings.TrimSpace(change.Reason)
	if !ValidReason(change.Reason) {
		return nil, invalid.Input(ErrInvalidOperation, "The reason must be at most 500 characters.")
	}
	if err := hosts.audit.Record(ctx, actorID, "", "host.state.requested", change.Reason, map[string]any{"host": id}); err != nil {
		return nil, err
	}
	request, err := json.Marshal(map[string]any{
		"document": change.Document, "confirmations": change.Confirmations, "reason": change.Reason,
		"converge": change.Converge, "requestedBy": actorID,
	})
	if err != nil {
		return nil, err
	}
	result, err := agent.ApplyState(ctx, request)
	if err != nil {
		_ = hosts.audit.Record(ctx, actorID, "", "host.state.failed", change.Reason, map[string]any{"host": id, "error": err.Error()})
		return nil, err
	}
	var outcome struct {
		Document  json.RawMessage `json:"document"`
		Previous  json.RawMessage `json:"previous"`
		Operation *struct {
			ID string `json:"id"`
		} `json:"operation"`
	}
	details := map[string]any{"host": id}
	if json.Unmarshal(result, &outcome) == nil {
		details["changes"] = DiffDocuments(outcome.Previous, outcome.Document)
		if outcome.Operation != nil {
			details["operation"] = outcome.Operation.ID
		}
	}
	if err := hosts.audit.Record(ctx, actorID, "", "host.state.changed", change.Reason, details); err != nil {
		slog.Error("host state audit failed", "err", err)
	}
	return result, nil
}

// Cancel audits and forwards a cancellation.
func (hosts *Hosts) Cancel(ctx context.Context, actorID, id, operation string) (json.RawMessage, error) {
	agent, err := hosts.agent(id)
	if err != nil {
		return nil, err
	}
	details := map[string]any{"host": id, "operation": operation}
	if err := hosts.audit.Record(ctx, actorID, "", "host.operation.cancel", "", details); err != nil {
		return nil, err
	}
	return agent.CancelOperation(ctx, operation)
}

// StartCheck audits and forwards a check the administrator starts outside its schedule.
func (hosts *Hosts) StartCheck(ctx context.Context, actorID, id string, check CheckRequest) (json.RawMessage, error) {
	agent, err := hosts.agent(id)
	if err != nil {
		return nil, err
	}
	check.Reason = strings.TrimSpace(check.Reason)
	if !ValidReason(check.Reason) {
		return nil, invalid.Input(ErrInvalidOperation, "The reason must be at most 500 characters.")
	}
	details := map[string]any{"host": id, "kind": check.Kind}
	if err := hosts.audit.Record(ctx, actorID, "", "host.operation.start", check.Reason, details); err != nil {
		return nil, err
	}
	request, err := json.Marshal(map[string]string{"kind": check.Kind, "reason": check.Reason, "requestedBy": actorID})
	if err != nil {
		return nil, err
	}
	return agent.StartCheck(ctx, request)
}

// Usage returns what fills the host's storage and its history within window.
func (hosts *Hosts) Usage(ctx context.Context, id, window string) (json.RawMessage, error) {
	agent, err := hosts.agent(id)
	if err != nil {
		return nil, err
	}
	return agent.Usage(ctx, window)
}

// MeasureUsage asks the host to measure its storage now instead of at the next hour.
func (hosts *Hosts) MeasureUsage(ctx context.Context, id string) (json.RawMessage, error) {
	agent, err := hosts.agent(id)
	if err != nil {
		return nil, err
	}
	return agent.MeasureUsage(ctx)
}

// Deploy asks the host to install the release that a trusted GitHub Actions run built.
func (hosts *Hosts) Deploy(ctx context.Context, id string, run int64) (json.RawMessage, error) {
	agent, err := hosts.agent(id)
	if err != nil {
		return nil, err
	}
	return agent.Deploy(ctx, run)
}

func (hosts *Hosts) Deployment(ctx context.Context, id string, run int64) (json.RawMessage, error) {
	agent, err := hosts.agent(id)
	if err != nil {
		return nil, err
	}
	return agent.Deployment(ctx, run)
}

// DiffDocuments lists changed leaves between two JSON documents; arrays compare as whole values.
func DiffDocuments(before, after json.RawMessage) []DocumentChange {
	var left, right any
	_ = json.Unmarshal(before, &left)
	_ = json.Unmarshal(after, &right)
	changes := []DocumentChange{}
	diffValues("", left, right, &changes)
	return changes
}

func diffValues(path string, left, right any, changes *[]DocumentChange) {
	leftMap, leftIsMap := left.(map[string]any)
	rightMap, rightIsMap := right.(map[string]any)
	if leftIsMap && rightIsMap {
		keys := slices.Sorted(maps.Keys(rightMap))
		for key := range leftMap {
			if _, kept := rightMap[key]; !kept {
				keys = append(keys, key)
			}
		}
		for _, key := range keys {
			// The revision always changes and is recorded by the store itself
			if path == "" && key == "revision" {
				continue
			}
			diffValues(strings.TrimPrefix(path+"."+key, "."), leftMap[key], rightMap[key], changes)
		}
		return
	}
	if !reflect.DeepEqual(left, right) {
		*changes = append(*changes, DocumentChange{Path: path, Before: left, After: right})
	}
}
