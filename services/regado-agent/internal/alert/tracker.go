// Package alert turns host facts into alerts and records when each opens, escalates and resolves.
package alert

// Persists open and recently resolved alerts and a numbered log of their transitions
import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"slices"
	"sync"
	"time"
)

type Severity string

const (
	Warning  Severity = "warning"
	Critical Severity = "critical"
)

// Condition is a problem that holds right now. Its key stays stable while the problem lasts.
type Condition struct {
	Key      string   `json:"key"`
	Severity Severity `json:"severity"`
	Summary  string   `json:"summary"`
}

type Alert struct {
	Condition
	FirstSeen  time.Time  `json:"firstSeen"`
	LastSeen   time.Time  `json:"lastSeen"`
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`
}

type EventKind string

const (
	Opened    EventKind = "opened"
	Escalated EventKind = "escalated"
	Resolved  EventKind = "resolved"
)

// Event is one transition. Sequences only grow, so a reader resumes after the last one it handled.
type Event struct {
	Sequence int64     `json:"sequence"`
	Kind     EventKind `json:"kind"`
	Condition
	At time.Time `json:"at"`
}

// Report is what readers receive: every retained alert and the events after their cursor.
type Report struct {
	Alerts   []Alert `json:"alerts"`
	Events   []Event `json:"events"`
	Sequence int64   `json:"sequence"`
}

const (
	fileName     = "alerts.json"
	keepEvents   = 500
	keepResolved = 30 * 24 * time.Hour
)

type snapshot struct {
	Alerts   map[string]Alert `json:"alerts"`
	Events   []Event          `json:"events"`
	Sequence int64            `json:"sequence"`
}

type Tracker struct {
	mu   sync.Mutex
	root *os.Root
	data snapshot
}

func Open(directory string) (*Tracker, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	tracker := &Tracker{root: root, data: snapshot{Alerts: map[string]Alert{}, Events: []Event{}}}
	raw, err := root.ReadFile(fileName)
	if errors.Is(err, fs.ErrNotExist) {
		return tracker, nil
	}
	if err == nil {
		err = json.Unmarshal(raw, &tracker.data)
	}
	if err != nil {
		_ = root.Close()
		return nil, err
	}
	if tracker.data.Alerts == nil {
		tracker.data.Alerts = map[string]Alert{}
	}
	return tracker, nil
}

func (tracker *Tracker) Close() { _ = tracker.root.Close() }

func rank(severity Severity) int {
	if severity == Critical {
		return 1
	}
	return 0
}

// Update records the conditions that hold at now and persists any transition.
func (tracker *Tracker) Update(conditions []Condition, now time.Time) error {
	tracker.mu.Lock()
	defer tracker.mu.Unlock()
	changed := false
	present := map[string]bool{}
	for _, condition := range conditions {
		present[condition.Key] = true
		current, open := tracker.data.Alerts[condition.Key]
		if open && current.ResolvedAt == nil {
			if rank(condition.Severity) > rank(current.Severity) {
				tracker.record(Escalated, condition, now)
				changed = true
			}
			current.Condition, current.LastSeen = condition, now
			tracker.data.Alerts[condition.Key] = current
			continue
		}
		tracker.data.Alerts[condition.Key] = Alert{Condition: condition, FirstSeen: now, LastSeen: now}
		tracker.record(Opened, condition, now)
		changed = true
	}
	for key, current := range tracker.data.Alerts {
		switch {
		case current.ResolvedAt == nil && !present[key]:
			resolved := now
			current.ResolvedAt = &resolved
			tracker.data.Alerts[key] = current
			tracker.record(Resolved, current.Condition, now)
			changed = true
		case current.ResolvedAt != nil && now.Sub(*current.ResolvedAt) > keepResolved:
			delete(tracker.data.Alerts, key)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return tracker.save()
}

func (tracker *Tracker) record(kind EventKind, condition Condition, now time.Time) {
	tracker.data.Sequence++
	tracker.data.Events = append(tracker.data.Events, Event{Sequence: tracker.data.Sequence, Kind: kind, Condition: condition, At: now})
	if len(tracker.data.Events) > keepEvents {
		tracker.data.Events = tracker.data.Events[len(tracker.data.Events)-keepEvents:]
	}
}

// save replaces the file atomically so a crash never leaves a partial record
func (tracker *Tracker) save() error {
	raw, err := json.Marshal(tracker.data)
	if err != nil {
		return err
	}
	if err := tracker.root.WriteFile(fileName+".tmp", raw, 0o600); err != nil {
		return err
	}
	return tracker.root.Rename(fileName+".tmp", fileName)
}

// Read returns open alerts by severity, then resolved ones newest first, and events after after.
func (tracker *Tracker) Read(after int64) Report {
	tracker.mu.Lock()
	defer tracker.mu.Unlock()
	alerts := make([]Alert, 0, len(tracker.data.Alerts))
	for _, item := range tracker.data.Alerts {
		alerts = append(alerts, item)
	}
	slices.SortFunc(alerts, func(a, b Alert) int {
		if (a.ResolvedAt == nil) != (b.ResolvedAt == nil) {
			if a.ResolvedAt == nil {
				return -1
			}
			return 1
		}
		if a.ResolvedAt != nil {
			return b.ResolvedAt.Compare(*a.ResolvedAt)
		}
		if rank(a.Severity) != rank(b.Severity) {
			return rank(b.Severity) - rank(a.Severity)
		}
		return a.FirstSeen.Compare(b.FirstSeen)
	})
	events := []Event{}
	for _, event := range tracker.data.Events {
		if event.Sequence > after {
			events = append(events, event)
		}
	}
	return Report{Alerts: alerts, Events: events, Sequence: tracker.data.Sequence}
}
