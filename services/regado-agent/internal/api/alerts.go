package api

// Evaluates the host's alerts on a schedule and serves them with the delivery settings
import (
	"context"
	"log/slog"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/alert"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
)

// AlertReport is what Kerno polls: alerts, the events after its cursor and where to deliver them.
type AlertReport struct {
	alert.Report
	Host string             `json:"host"`
	Ntfy *state.NtfyChannel `json:"ntfy"`
}

// EvaluateAlerts compares the host with its desired state and records alert transitions.
func (service *Service) EvaluateAlerts(ctx context.Context) error {
	facts, err := service.Facts(ctx)
	if err != nil {
		return err
	}
	recent, err := service.Operations.List(100)
	if err != nil {
		return err
	}
	inputs := alert.Inputs{Devices: facts.Devices, Pool: facts.Pool, Desired: facts.Desired, Drift: facts.Drift, Operations: recent}
	if service.Usage != nil {
		inputs.FullInDays = service.Usage.Report(0).FullInDays
	}
	// An unreadable deployment record must not hide the host's other alerts
	if inputs.Deployment, err = service.Deployments.Latest(); err != nil {
		slog.Warn("deployment record unavailable", "err", err)
	}
	return service.Alerts.Update(alert.Evaluate(inputs), time.Now())
}

// WatchAlerts evaluates alerts every interval until ctx ends.
func (service *Service) WatchAlerts(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		if err := service.EvaluateAlerts(ctx); err != nil && ctx.Err() == nil {
			slog.Warn("alert evaluation failed", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (service *Service) AlertReport(after int64) (AlertReport, error) {
	desired, err := service.States.Current()
	if err != nil {
		return AlertReport{}, err
	}
	return AlertReport{Report: service.Alerts.Read(after), Host: service.Host.Name, Ntfy: desired.Alerts.Ntfy}, nil
}
