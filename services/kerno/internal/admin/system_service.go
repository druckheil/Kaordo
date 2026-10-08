package admin

// Executes audited system commands through host and file-maintenance ports
import (
	"context"
	"encoding/json"
	"log"
	"strings"
)

type SystemAgent interface {
	SystemCommands
	Snapshot(context.Context) (json.RawMessage, error)
	Logs(context.Context, string) (json.RawMessage, error)
}

type StorageMaintenance interface {
	StorageStatus(context.Context) (json.RawMessage, error)
	StartStorageMaintenance(context.Context, bool) error
}

type AuditRecorder interface {
	Record(context.Context, string, string, string, string, any) error
}

// SystemCommands keeps the operation consumer independent of agent reads.
type SystemCommands interface {
	Action(context.Context, string, ActionRequest) (json.RawMessage, error)
}

type SystemOperations struct {
	audit       AuditRecorder
	system      SystemCommands
	maintenance StorageMaintenance
}

func NewSystemOperations(audit AuditRecorder, system SystemCommands, maintenance StorageMaintenance) *SystemOperations {
	return &SystemOperations{audit: audit, system: system, maintenance: maintenance}
}

func (service *SystemOperations) Execute(ctx context.Context, actorID string, command SystemAction) (json.RawMessage, error) {
	if service.system == nil {
		return nil, ErrSystemUnavailable
	}
	command.Reason = strings.TrimSpace(command.Reason)
	if err := command.Validate(); err != nil {
		return nil, err
	}
	mediaMaintenance := false
	if command.Name == "check-storage" || command.Name == "repair-storage" {
		var err error
		mediaMaintenance, err = service.prepareStorageMaintenance(ctx, command.Request.Target)
		if err != nil {
			return nil, err
		}
	}
	if err := service.record(ctx, actorID, command, "", "requested"); err != nil {
		return nil, err
	}
	result, err := service.system.Action(ctx, command.Name, command.Request)
	if err == nil && mediaMaintenance {
		err = service.maintenance.StartStorageMaintenance(ctx, command.Name == "repair-storage")
	}
	if err != nil {
		_ = service.record(ctx, actorID, command, "failed", "failed")
		return nil, err
	}
	if err := service.record(ctx, actorID, command, "completed", "accepted"); err != nil {
		log.Printf("Regado outcome audit failed: %v", err)
	}
	return result, nil
}

func (service *SystemOperations) prepareStorageMaintenance(ctx context.Context, target string) (bool, error) {
	if service.maintenance == nil {
		return false, ErrFileReferencesUnavailable
	}
	status, err := service.maintenance.StorageStatus(ctx)
	var media struct {
		Directory string `json:"directory"`
		State     string `json:"state"`
	}
	if err != nil || json.Unmarshal(status, &media) != nil || media.Directory == "" {
		return false, ErrFileReferencesUnavailable
	}
	required := media.Directory == target || strings.HasPrefix(media.Directory, target+"/")
	if required && (media.State == "checking" || media.State == "repairing") {
		return false, ErrStorageBusy
	}
	return required, nil
}

func (service *SystemOperations) record(ctx context.Context, actorID string, command SystemAction, stage, status string) error {
	event := "system." + command.Name
	if stage != "" {
		event += "." + stage
	}
	details := map[string]string{"status": status}
	if command.Request.Target != "" {
		details["target"] = command.Request.Target
	}
	if command.Request.Identity != "" {
		details["identity"] = command.Request.Identity
	}
	if command.Request.Filesystem != "" {
		details["filesystem"] = command.Request.Filesystem
	}
	return service.audit.Record(ctx, actorID, "", event, command.Reason, details)
}
