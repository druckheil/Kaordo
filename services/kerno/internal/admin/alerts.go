package admin

// Delivers each host alert transition once to administrators through Ligo and an ntfy topic
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"
)

// NtfyChannel is the push topic a host's desired state names; any token stays in Kerno's environment.
type NtfyChannel struct {
	URL   string `json:"url"`
	Topic string `json:"topic"`
}

// AlertEvent is one transition an agent recorded: opened, escalated or resolved.
type AlertEvent struct {
	Sequence int64     `json:"sequence"`
	Kind     string    `json:"kind"`
	Key      string    `json:"key"`
	Severity string    `json:"severity"`
	Summary  string    `json:"summary"`
	At       time.Time `json:"at"`
}

type alertReport struct {
	Host     string          `json:"host"`
	Ntfy     *NtfyChannel    `json:"ntfy"`
	Alerts   json.RawMessage `json:"alerts"`
	Events   []AlertEvent    `json:"events"`
	Sequence int64           `json:"sequence"`
}

// Notice is one message to administrators.
type Notice struct {
	Title    string
	Message  string
	Priority string
	Tags     []string
}

// AlertStore persists delivery progress and writes administrator notices.
type AlertStore interface {
	AlertCursor(ctx context.Context, host string) (int64, error)
	SetAlertCursor(ctx context.Context, host string, sequence int64) error
	NotifyAdministrators(ctx context.Context, text string) error
}

// Pusher publishes a notice to a push channel.
type Pusher interface {
	Push(ctx context.Context, channel NtfyChannel, notice Notice) error
}

// deliveryWindow keeps a reset cursor from replaying old transitions as news
const deliveryWindow = 24 * time.Hour

type AlertDelivery struct {
	hosts *Hosts
	store AlertStore
	push  Pusher
	now   func() time.Time
}

func NewAlertDelivery(hosts *Hosts, store AlertStore, push Pusher, now func() time.Time) *AlertDelivery {
	return &AlertDelivery{hosts: hosts, store: store, push: push, now: now}
}

// Run delivers new transitions every interval until ctx ends. A lasting failure, such as an
// unreachable agent, is logged when it starts and when it ends rather than every interval.
func (delivery *AlertDelivery) Run(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	failing := ""
	for {
		err := delivery.Deliver(ctx)
		switch {
		case ctx.Err() != nil:
		case err != nil && err.Error() != failing:
			failing = err.Error()
			slog.Warn("alert delivery failed", "err", err)
		case err == nil && failing != "":
			failing = ""
			slog.Info("alert delivery recovered")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Deliver sends every host's undelivered transitions in order and advances its cursor.
func (delivery *AlertDelivery) Deliver(ctx context.Context) error {
	var failures []error
	for _, id := range delivery.hosts.IDs() {
		if err := delivery.deliverHost(ctx, id); err != nil {
			failures = append(failures, fmt.Errorf("host %s: %w", id, err))
		}
	}
	return errors.Join(failures...)
}

func (delivery *AlertDelivery) deliverHost(ctx context.Context, id string) error {
	cursor, err := delivery.store.AlertCursor(ctx, id)
	if err != nil {
		return err
	}
	report, err := delivery.report(ctx, id, cursor)
	if err != nil {
		return err
	}
	if report.Sequence < cursor {
		// The agent lost its alert history; its new sequence starts again from zero
		if report, err = delivery.report(ctx, id, 0); err != nil {
			return err
		}
	}
	for _, event := range report.Events {
		if delivery.now().Sub(event.At) <= deliveryWindow {
			if err := delivery.send(ctx, report.Ntfy, eventNotice(report.Host, event)); err != nil {
				return err
			}
		}
		if err := delivery.store.SetAlertCursor(ctx, id, event.Sequence); err != nil {
			return err
		}
	}
	if report.Sequence != cursor && len(report.Events) == 0 {
		return delivery.store.SetAlertCursor(ctx, id, report.Sequence)
	}
	return nil
}

func (delivery *AlertDelivery) report(ctx context.Context, id string, after int64) (alertReport, error) {
	agent, err := delivery.hosts.agent(id)
	if err != nil {
		return alertReport{}, err
	}
	raw, err := agent.Alerts(ctx, after)
	if err != nil {
		return alertReport{}, err
	}
	var report alertReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return alertReport{}, fmt.Errorf("decode alert report: %w", err)
	}
	return report, nil
}

// send stores the Ligo notice first: it is the durable record. Push delivery is best effort.
func (delivery *AlertDelivery) send(ctx context.Context, channel *NtfyChannel, notice Notice) error {
	if err := delivery.store.NotifyAdministrators(ctx, notice.Title+": "+notice.Message); err != nil {
		return err
	}
	if channel != nil {
		if err := delivery.push.Push(ctx, *channel, notice); err != nil {
			slog.Warn("ntfy delivery failed", "topic", channel.Topic, "err", err)
		}
	}
	return nil
}

func eventNotice(host string, event AlertEvent) Notice {
	notice := Notice{Message: event.Summary}
	severity := "Warning"
	notice.Priority, notice.Tags = "high", []string{"warning"}
	if event.Severity == "critical" {
		severity = "Critical"
		notice.Priority, notice.Tags = "urgent", []string{"rotating_light"}
	}
	switch event.Kind {
	case "escalated":
		notice.Title = "Now critical on " + host
	case "resolved":
		notice.Title = "Resolved on " + host
		notice.Priority, notice.Tags = "default", []string{"white_check_mark"}
	default:
		notice.Title = severity + " on " + host
	}
	return notice
}

// TestResult says where a test notice arrived.
type TestResult struct {
	Ligo bool   `json:"ligo"`
	Ntfy string `json:"ntfy"`
}

// SendTest audits and sends a notice through every channel, so an operator can confirm delivery.
func (delivery *AlertDelivery) SendTest(ctx context.Context, actorID, id string) (TestResult, error) {
	report, err := delivery.report(ctx, id, math.MaxInt64)
	if err != nil {
		return TestResult{}, err
	}
	if err := delivery.hosts.audit.Record(ctx, actorID, "", "host.alerts.test", "", map[string]any{"host": id}); err != nil {
		return TestResult{}, err
	}
	notice := Notice{
		Title: "Test from " + report.Host, Message: "Regado alerts reach you here.",
		Priority: "default", Tags: []string{"bell"},
	}
	if err := delivery.store.NotifyAdministrators(ctx, notice.Title+": "+notice.Message); err != nil {
		return TestResult{}, err
	}
	result := TestResult{Ligo: true, Ntfy: "not configured"}
	if report.Ntfy != nil {
		result.Ntfy = "sent"
		if err := delivery.push.Push(ctx, *report.Ntfy, notice); err != nil {
			result.Ntfy = "failed: " + strings.TrimSpace(err.Error())
		}
	}
	return result, nil
}

// Alerts returns a host's open and recently resolved alerts without its event log.
func (delivery *AlertDelivery) Alerts(ctx context.Context, id string) (json.RawMessage, error) {
	report, err := delivery.report(ctx, id, math.MaxInt64)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]json.RawMessage{"alerts": report.Alerts})
}
