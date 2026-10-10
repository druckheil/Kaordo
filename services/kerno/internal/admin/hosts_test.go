package admin

// Verifies host change auditing, refusal handling and desired state diffs
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/invalid"
)

type agentStub struct {
	applied json.RawMessage
	started json.RawMessage
	alerts  func(after int64) string
	result  json.RawMessage
	err     error
}

func (*agentStub) Host(context.Context) (json.RawMessage, error) { return json.RawMessage(`{}`), nil }
func (*agentStub) PlanState(context.Context, json.RawMessage) (json.RawMessage, error) {
	return json.RawMessage(`{"steps":[]}`), nil
}
func (stub *agentStub) ApplyState(_ context.Context, change json.RawMessage) (json.RawMessage, error) {
	stub.applied = change
	return stub.result, stub.err
}
func (*agentStub) Operations(context.Context, int) (json.RawMessage, error) { return nil, nil }
func (*agentStub) Operation(context.Context, string) (json.RawMessage, error) {
	return nil, nil
}
func (*agentStub) CancelOperation(context.Context, string) (json.RawMessage, error) {
	return json.RawMessage(`{"state":"cancelled"}`), nil
}
func (stub *agentStub) Alerts(_ context.Context, after int64) (json.RawMessage, error) {
	return json.RawMessage(stub.alerts(after)), nil
}
func (*agentStub) Usage(_ context.Context, window string) (json.RawMessage, error) {
	return json.RawMessage(`{"window":"` + window + `"}`), nil
}
func (*agentStub) MeasureUsage(context.Context) (json.RawMessage, error) {
	return json.RawMessage(`{"measuring":true}`), nil
}
func (stub *agentStub) StartCheck(_ context.Context, check json.RawMessage) (json.RawMessage, error) {
	stub.started = check
	return json.RawMessage(`{"id":"op-2"}`), nil
}

type auditEvent struct {
	event   string
	details map[string]any
}

type auditStub struct{ events []auditEvent }

func (stub *auditStub) Record(_ context.Context, _, _, event, _ string, details any) error {
	stub.events = append(stub.events, auditEvent{event: event, details: details.(map[string]any)})
	return nil
}

func TestApplyAuditsTheRequestAndTheResultingDiff(t *testing.T) {
	agent := &agentStub{result: json.RawMessage(`{
		"previous": {"revision": 1, "pool": {"devices": ["wwn-a", "wwn-b"]}, "integrity": {"scrub": "monthly"}},
		"document": {"revision": 2, "pool": {"devices": ["wwn-a", "wwn-b", "wwn-c"]}, "integrity": {"scrub": "monthly"}},
		"operation": {"id": "op-1"}}`)}
	audit := &auditStub{}
	hosts := NewHosts(map[string]HostAgent{"local": agent}, audit)
	_, err := hosts.Apply(context.Background(), "actor-1", "local", StateChange{
		Document: json.RawMessage(`{"revision":1}`), Confirmations: []string{"SERIAL"}, Reason: "  Grow the pool  ",
	})
	if err != nil {
		t.Fatal(err)
	}
	var forwarded map[string]any
	if json.Unmarshal(agent.applied, &forwarded) != nil || forwarded["requestedBy"] != "actor-1" || forwarded["reason"] != "Grow the pool" {
		t.Fatalf("forwarded change = %s", agent.applied)
	}
	if len(audit.events) != 2 || audit.events[0].event != "host.state.requested" || audit.events[1].event != "host.state.changed" {
		t.Fatalf("audit = %+v", audit.events)
	}
	changes := audit.events[1].details["changes"].([]DocumentChange)
	if len(changes) != 1 || changes[0].Path != "pool.devices" || audit.events[1].details["operation"] != "op-1" {
		t.Fatalf("recorded changes = %+v", audit.events[1].details)
	}
}

func TestApplyRecordsRefusalsAndBoundsOptionalReasons(t *testing.T) {
	refusal := &AgentError{Status: 422, Message: "Erasing a device needs its serial number."}
	audit := &auditStub{}
	hosts := NewHosts(map[string]HostAgent{"local": &agentStub{err: refusal}}, audit)
	_, err := hosts.Apply(context.Background(), "actor-1", "local", StateChange{Document: json.RawMessage(`{}`), Reason: "Grow the pool"})
	if !errors.As(err, &refusal) || len(audit.events) != 2 || audit.events[1].event != "host.state.failed" {
		t.Fatalf("refusal = %v, audit %+v", err, audit.events)
	}
	if _, err := hosts.Apply(context.Background(), "actor-1", "local", StateChange{Reason: strings.Repeat("x", 501)}); !errors.Is(err, ErrInvalidOperation) {
		t.Fatalf("oversized reason = %v", err)
	} else if message, ok := invalid.Message(err); !ok || message == "" {
		t.Fatalf("oversized reason has no message: %v", err)
	}
	if _, err := hosts.Facts(context.Background(), "elsewhere"); !errors.Is(err, ErrUnknownHost) {
		t.Fatalf("unknown host = %v", err)
	}
}

func TestStartCheckAuditsBeforeForwardingTheActor(t *testing.T) {
	agent := &agentStub{}
	audit := &auditStub{}
	hosts := NewHosts(map[string]HostAgent{"local": agent}, audit)
	if _, err := hosts.StartCheck(context.Background(), "actor-1", "local", CheckRequest{Kind: "integrity.scrub", Reason: strings.Repeat("x", 501)}); !errors.Is(err, ErrInvalidOperation) || agent.started != nil {
		t.Fatalf("oversized reason = %v, forwarded %s", err, agent.started)
	}
	if _, err := hosts.StartCheck(context.Background(), "actor-1", "local", CheckRequest{Kind: "integrity.scrub", Reason: " Verify copies after a power cut "}); err != nil {
		t.Fatal(err)
	}
	var forwarded map[string]string
	if json.Unmarshal(agent.started, &forwarded) != nil || forwarded["requestedBy"] != "actor-1" || forwarded["reason"] != "Verify copies after a power cut" {
		t.Fatalf("forwarded check = %s", agent.started)
	}
	if len(audit.events) != 1 || audit.events[0].event != "host.operation.start" || audit.events[0].details["kind"] != "integrity.scrub" {
		t.Fatalf("audit = %+v", audit.events)
	}
}

func TestOptionalHostReasonsPreserveActorAndAudit(t *testing.T) {
	for _, reason := range []string{"", "x", "  "} {
		t.Run(fmt.Sprintf("reason_%q", reason), func(t *testing.T) {
			agent := &agentStub{result: json.RawMessage(`{"previous":{},"document":{}}`)}
			audit := &auditStub{}
			hosts := NewHosts(map[string]HostAgent{"local": agent}, audit)
			if _, err := hosts.Apply(context.Background(), "actor-1", "local", StateChange{Document: json.RawMessage(`{}`), Reason: reason}); err != nil {
				t.Fatal(err)
			}
			if _, err := hosts.StartCheck(context.Background(), "actor-1", "local", CheckRequest{Kind: "integrity.scrub", Reason: reason}); err != nil {
				t.Fatal(err)
			}
			for _, raw := range []json.RawMessage{agent.applied, agent.started} {
				var request map[string]any
				if json.Unmarshal(raw, &request) != nil || request["requestedBy"] != "actor-1" || request["reason"] != strings.TrimSpace(reason) {
					t.Fatalf("forwarded request = %s", raw)
				}
			}
			if len(audit.events) != 3 || audit.events[0].event != "host.state.requested" || audit.events[1].event != "host.state.changed" || audit.events[2].event != "host.operation.start" {
				t.Fatalf("audit = %+v", audit.events)
			}
		})
	}
}

func TestDiffDocumentsReportsAddedRemovedAndChangedLeaves(t *testing.T) {
	changes := DiffDocuments(
		json.RawMessage(`{"revision":3,"alerts":{"ntfy":null,"poolWarningPercent":80},"cleanup":{"journalDays":14}}`),
		json.RawMessage(`{"revision":4,"alerts":{"ntfy":{"topic":"kaordo-ops"},"poolWarningPercent":80},"backups":{"targets":[]}}`),
	)
	paths := map[string]bool{}
	for _, change := range changes {
		paths[change.Path] = true
	}
	if len(changes) != 3 || !paths["alerts.ntfy"] || !paths["backups"] || !paths["cleanup"] {
		t.Fatalf("changes = %+v", changes)
	}
}
