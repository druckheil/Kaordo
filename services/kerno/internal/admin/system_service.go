package admin

// Executes audited system commands through host and media-maintenance ports
import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
)

type SystemAgent interface {
	SystemCommands
	Snapshot(context.Context) (json.RawMessage, error)
	Logs(context.Context, string) (json.RawMessage, error)
}

// MediaMaintenance audits stored media against references and removes expired unreferenced uploads.
type MediaMaintenance interface {
	MediaStatus(context.Context) (json.RawMessage, error)
	StartMediaMaintenance(ctx context.Context, clean bool) error
}

type AuditRecorder interface {
	Record(context.Context, string, string, string, string, any) error
}

// SystemCommands keeps the operation consumer independent of agent reads.
type SystemCommands interface {
	Action(context.Context, string) (json.RawMessage, error)
}

type SystemOperations struct {
	audit  AuditRecorder
	system SystemCommands
	media  MediaMaintenance
}

func NewSystemOperations(audit AuditRecorder, system SystemCommands, media MediaMaintenance) *SystemOperations {
	return &SystemOperations{audit: audit, system: system, media: media}
}

func (service *SystemOperations) Execute(ctx context.Context, actorID string, command SystemAction) (json.RawMessage, error) {
	command.Reason = strings.TrimSpace(command.Reason)
	if err := command.Validate(); err != nil {
		return nil, err
	}
	clean, media := mediaActions[command.Name]
	if media {
		if err := service.mediaIdle(ctx); err != nil {
			return nil, err
		}
	} else if service.system == nil {
		return nil, ErrSystemUnavailable
	}
	if err := service.record(ctx, actorID, command, "", "requested"); err != nil {
		return nil, err
	}
	var result json.RawMessage
	var err error
	if media {
		err = service.media.StartMediaMaintenance(ctx, clean)
		result, _ = json.Marshal(map[string]any{"action": command.Name, "output": "", "accepted": err == nil})
	} else {
		result, err = service.system.Action(ctx, command.Name)
	}
	if err != nil {
		_ = service.record(ctx, actorID, command, "failed", "failed")
		return nil, err
	}
	if err := service.record(ctx, actorID, command, "completed", "accepted"); err != nil {
		slog.Error("Regado outcome audit failed", "err", err)
	}
	return result, nil
}

func (service *SystemOperations) mediaIdle(ctx context.Context) error {
	if service.media == nil {
		return ErrMediaUnavailable
	}
	status, err := service.media.MediaStatus(ctx)
	var report struct {
		State string `json:"state"`
	}
	if err != nil || json.Unmarshal(status, &report) != nil {
		return ErrMediaUnavailable
	}
	if report.State == "checking" || report.State == "repairing" {
		return ErrMediaBusy
	}
	return nil
}

func (service *SystemOperations) record(ctx context.Context, actorID string, command SystemAction, stage, status string) error {
	event := "system." + command.Name
	if stage != "" {
		event += "." + stage
	}
	return service.audit.Record(ctx, actorID, "", event, command.Reason, map[string]string{"status": status})
}
