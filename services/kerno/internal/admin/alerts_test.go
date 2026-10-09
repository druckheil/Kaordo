package admin

// Verifies that alert transitions reach administrators once, in order, and survive failures
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"
)

type deliveryStore struct {
	cursor  int64
	notices []string
	fail    bool
}

func (store *deliveryStore) AlertCursor(context.Context, string) (int64, error) {
	return store.cursor, nil
}
func (store *deliveryStore) SetAlertCursor(_ context.Context, _ string, sequence int64) error {
	store.cursor = sequence
	return nil
}
func (store *deliveryStore) NotifyAdministrators(_ context.Context, text string) error {
	if store.fail {
		return errors.New("database unavailable")
	}
	store.notices = append(store.notices, text)
	return nil
}

type pushStub struct{ notices []Notice }

func (push *pushStub) Push(_ context.Context, _ NtfyChannel, notice Notice) error {
	push.notices = append(push.notices, notice)
	return errors.New("ntfy unavailable")
}

// alertAgent serves events after the cursor from a fixed log
func alertAgent(events ...AlertEvent) *agentStub {
	return &agentStub{alerts: func(after int64) string {
		report := map[string]any{"host": "kaordo", "ntfy": map[string]string{"url": "https://ntfy.sh", "topic": "kaordo-ops-1"},
			"alerts": []any{}, "events": []AlertEvent{}, "sequence": int64(len(events))}
		pending := []AlertEvent{}
		for _, event := range events {
			if event.Sequence > after {
				pending = append(pending, event)
			}
		}
		report["events"] = pending
		raw, _ := json.Marshal(report)
		return string(raw)
	}}
}

func TestDeliveryNotifiesEachTransitionOnce(t *testing.T) {
	now := time.Date(2026, 10, 10, 3, 0, 0, 0, time.UTC)
	agent := alertAgent(AlertEvent{Sequence: 1, Kind: "opened", Severity: "warning", Summary: "Old news.", At: now.Add(-48 * time.Hour)},
		AlertEvent{Sequence: 2, Kind: "opened", Severity: "critical", Summary: "Device 2 is missing.", At: now.Add(-time.Minute)},
		AlertEvent{Sequence: 3, Kind: "resolved", Severity: "critical", Summary: "Device 2 is missing.", At: now},
	)
	store, push := &deliveryStore{}, &pushStub{}
	delivery := NewAlertDelivery(NewHosts(map[string]HostAgent{"local": agent}, &auditStub{}), store, push, func() time.Time { return now })
	for range 2 {
		if err := delivery.Deliver(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	want := []string{"Critical on kaordo: Device 2 is missing.", "Resolved on kaordo: Device 2 is missing."}
	if !slices.Equal(store.notices, want) || store.cursor != 3 {
		t.Fatalf("notices = %q, cursor %d", store.notices, store.cursor)
	}
	if len(push.notices) != 2 || push.notices[0].Priority != "urgent" || push.notices[1].Tags[0] != "white_check_mark" {
		t.Fatalf("pushes = %+v", push.notices)
	}
}

func TestDeliveryKeepsTheCursorWhenLigoFails(t *testing.T) {
	now := time.Date(2026, 10, 10, 3, 0, 0, 0, time.UTC)
	agent := alertAgent(AlertEvent{Sequence: 1, Kind: "opened", Severity: "warning", Summary: "The pool is 82% full.", At: now})
	store := &deliveryStore{fail: true}
	delivery := NewAlertDelivery(NewHosts(map[string]HostAgent{"local": agent}, &auditStub{}), store, &pushStub{}, func() time.Time { return now })
	if err := delivery.Deliver(context.Background()); err == nil || store.cursor != 0 {
		t.Fatalf("failed delivery = %v, cursor %d", err, store.cursor)
	}
	store.fail = false
	if err := delivery.Deliver(context.Background()); err != nil || len(store.notices) != 1 || store.cursor != 1 {
		t.Fatalf("retried delivery = %v, %q, cursor %d", err, store.notices, store.cursor)
	}
}

func TestDeliveryRestartsWhenTheAgentLostItsHistory(t *testing.T) {
	now := time.Date(2026, 10, 10, 3, 0, 0, 0, time.UTC)
	agent := alertAgent(AlertEvent{Sequence: 1, Kind: "opened", Severity: "warning", Summary: "No backup target is configured.", At: now})
	store := &deliveryStore{cursor: 40}
	delivery := NewAlertDelivery(NewHosts(map[string]HostAgent{"local": agent}, &auditStub{}), store, &pushStub{}, func() time.Time { return now })
	if err := delivery.Deliver(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(store.notices) != 1 || store.cursor != 1 {
		t.Fatalf("after agent reset: %q, cursor %d", store.notices, store.cursor)
	}
}

func TestSendTestAuditsAndReportsEachChannel(t *testing.T) {
	audit := &auditStub{}
	store := &deliveryStore{}
	delivery := NewAlertDelivery(NewHosts(map[string]HostAgent{"local": alertAgent()}, audit), store, &pushStub{}, time.Now)
	result, err := delivery.SendTest(context.Background(), "actor-1", "local")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Ligo || !strings.HasPrefix(result.Ntfy, "failed: ") || len(audit.events) != 1 || audit.events[0].event != "host.alerts.test" {
		t.Fatalf("result = %+v, audit %+v", result, audit.events)
	}
	if store.notices[0] != fmt.Sprintf("Test from %s: Regado alerts reach you here.", "kaordo") {
		t.Fatalf("notice = %q", store.notices[0])
	}
}
