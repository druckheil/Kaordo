package upload

// Audits stored upload artifacts and safely reuses garbage collection for expired unused files
import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"time"

	"github.com/druckheil/Kaordo/services/mediaauth"
)

type storageMaintenance struct {
	Directory       string               `json:"directory"`
	State           string               `json:"state"`
	StartedAt       *time.Time           `json:"startedAt"`
	CheckedAt       *time.Time           `json:"checkedAt"`
	Files           int64                `json:"files"`
	Bytes           int64                `json:"bytes"`
	SurplusFiles    int64                `json:"surplusFiles"`
	SurplusBytes    int64                `json:"surplusBytes"`
	UnverifiedFiles int64                `json:"unverifiedFiles"`
	MissingFiles    int64                `json:"missingFiles"`
	RemovedFiles    int64                `json:"removedFiles"`
	RemovedBytes    int64                `json:"removedBytes"`
	Error           string               `json:"error"`
	Stage           string               `json:"stage"`
	Progress        *maintenanceProgress `json:"progress"`
}

type maintenanceProgress struct {
	Completed int64  `json:"completed"`
	Total     *int64 `json:"total"`
	Unit      string `json:"unit"`
}

func (server *Server) maintenanceProgress(stage string, completed, total int64, unit string) {
	server.maintenanceMu.Lock()
	defer server.maintenanceMu.Unlock()
	if !server.maintenanceRunning {
		return
	}
	server.maintenance.Stage = stage
	server.maintenance.Progress = &maintenanceProgress{Completed: completed, Total: &total, Unit: unit}
}

type uploadArtifacts struct{ files, bytes int64 }

func (server *Server) storageStatus(w http.ResponseWriter, r *http.Request) {
	if !mediaauth.VerifyInternalToken(r.Header.Get("X-Kaordo-Internal-Token"), server.config.MediaKey) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	server.maintenanceMu.Lock()
	report := server.maintenance
	server.maintenanceMu.Unlock()
	report.Directory = server.config.Directory
	if report.State == "" {
		report.State = "idle"
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(report)
}

func (server *Server) startStorageMaintenance(w http.ResponseWriter, r *http.Request) {
	if !mediaauth.VerifyInternalToken(r.Header.Get("X-Kaordo-Internal-Token"), server.config.MediaKey) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	operation := r.PathValue("operation")
	if operation != "check" && operation != "repair" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	server.maintenanceMu.Lock()
	defer server.maintenanceMu.Unlock()
	if server.closing || server.maintenanceRunning {
		w.WriteHeader(http.StatusConflict)
		return
	}
	now := time.Now().UTC()
	server.maintenance = storageMaintenance{Directory: server.config.Directory, State: "checking", StartedAt: &now}
	if operation == "repair" {
		server.maintenance.State = "repairing"
	}
	server.maintenanceRunning = true
	server.workers.Add(1)
	go server.runStorageMaintenance(operation == "repair")
	w.WriteHeader(http.StatusAccepted)
}

func (server *Server) runStorageMaintenance(repair bool) {
	defer server.workers.Done()
	ctx, cancel := context.WithTimeout(server.ctx, 24*time.Hour)
	defer cancel()
	report, err := server.auditStorage(ctx, repair)
	if repair && err == nil {
		fresh, freshErr := server.auditStorage(ctx, false)
		fresh.RemovedFiles, fresh.RemovedBytes = report.RemovedFiles, report.RemovedBytes
		report, err = fresh, freshErr
	}
	now := time.Now().UTC()
	report.CheckedAt = &now
	server.maintenanceMu.Lock()
	defer server.maintenanceMu.Unlock()
	if err != nil {
		report.State, report.Error = "failed", "File references could not be fully verified. Unverified files were retained."
		report.Stage, report.Progress = server.maintenance.Stage, server.maintenance.Progress
	} else {
		report.State, report.Stage = "complete", "complete"
		total := report.Files
		report.Progress = &maintenanceProgress{Completed: total, Total: &total, Unit: "files"}
	}
	report.StartedAt = server.maintenance.StartedAt
	server.maintenance, server.maintenanceRunning = report, false
}

func (server *Server) auditStorage(ctx context.Context, repair bool) (storageMaintenance, error) {
	report := storageMaintenance{Directory: server.config.Directory}
	entries, err := os.ReadDir(server.config.Directory)
	if err != nil {
		return report, err
	}
	groups, err := server.inventoryUploadArtifacts(ctx, entries, &report)
	if err != nil {
		return report, err
	}
	missing, err := server.missingDisplayArtifacts(ctx, groups, &report)
	if err != nil {
		return report, err
	}
	var auditErr error
	candidates := expiredUploadIDs(server.config.Directory, entries)
	for index, id := range candidates {
		server.maintenanceProgress("references", int64(index), int64(len(candidates)), "uploads")
		if err := ctx.Err(); err != nil {
			return report, err
		}
		if err := server.auditUploadReferences(ctx, repair, id, groups[id], missing[id], &report); err != nil {
			auditErr = err
		}
	}
	return report, auditErr
}

func (server *Server) inventoryUploadArtifacts(ctx context.Context, entries []os.DirEntry, report *storageMaintenance) (map[string]uploadArtifacts, error) {
	groups := make(map[string]uploadArtifacts)
	for index, entry := range entries {
		server.maintenanceProgress("inventory", int64(index), int64(len(entries)), "files")
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			report.UnverifiedFiles++
			continue
		}
		if !info.Mode().IsRegular() {
			continue
		}
		report.Files++
		report.Bytes += info.Size()
		id := uploadIDFromFilename(entry.Name())
		if id == "" {
			report.UnverifiedFiles++
			continue
		}
		group := groups[id]
		group.files++
		group.bytes += info.Size()
		groups[id] = group
	}
	return groups, nil
}

func (server *Server) missingDisplayArtifacts(ctx context.Context, groups map[string]uploadArtifacts, report *storageMaintenance) (map[string]bool, error) {
	missing := make(map[string]bool)
	for id, group := range groups {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if _, err := os.Stat(server.readyPath(id)); err == nil {
			if _, err := os.Stat(server.displayPath(id)); errors.Is(err, os.ErrNotExist) {
				report.MissingFiles++
				report.UnverifiedFiles += group.files
				missing[id] = true
			}
		}
	}
	return missing, nil
}

func (server *Server) auditUploadReferences(ctx context.Context, repair bool, id string, group uploadArtifacts, missing bool, report *storageMaintenance) error {
	eligible, err := server.gcEligible(id)
	if err != nil {
		report.UnverifiedFiles += group.files
		return err
	}
	if !eligible {
		return nil
	}
	referenced, err := server.referenced(ctx, id)
	if err != nil {
		if !missing {
			report.UnverifiedFiles += group.files
		}
		return err
	}
	if referenced {
		return nil
	}
	if missing {
		report.UnverifiedFiles -= group.files
	}
	report.SurplusFiles += group.files
	report.SurplusBytes += group.bytes
	if !repair {
		return nil
	}
	// Recheck references at deletion time; never delete fresh uploads or unreadable records
	removed, err := server.removeIfUnreferenced(ctx, id)
	if err != nil {
		return err
	}
	if removed {
		report.RemovedFiles += group.files
		report.RemovedBytes += group.bytes
	}
	return nil
}

func (server *Server) removeIfUnreferenced(ctx context.Context, id string) (bool, error) {
	referenced, err := server.referenced(ctx, id)
	if err != nil || referenced {
		return false, err
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	eligible, err := server.gcEligible(id)
	if err != nil || !eligible {
		return false, err
	}
	if err := server.removeFiles(id); err != nil {
		return false, err
	}
	return true, nil
}
