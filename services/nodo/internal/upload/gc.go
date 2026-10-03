package upload

// Scans for expired, unreferenced uploads and schedules periodic cleanup
import (
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"
	"time"
)

const uploadRetention = 24 * time.Hour
const uploadAcceptance = uploadRetention - time.Hour

func (server *Server) uploadExpired(id string) bool {
	info, err := os.Stat(filepath.Join(server.config.Directory, id+".info"))
	// Stop accepting a file before garbage collection can remove unclaimed bytes.
	// Kerno has time to commit its media claim after validation.
	return err != nil || time.Since(info.ModTime()) > uploadAcceptance
}

func (server *Server) cleanupLoop() {
	server.garbageCollect(server.ctx)
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-server.ctx.Done():
			return
		case <-ticker.C:
			server.garbageCollect(server.ctx)
		}
	}
}

func (server *Server) garbageCollect(ctx context.Context) {
	entries, err := os.ReadDir(server.config.Directory)
	if err != nil {
		log.Printf("Nodo cleanup scan failed: %v", err)
		return
	}

	for _, id := range expiredUploadIDs(server.config.Directory, entries) {
		if ctx.Err() != nil {
			return
		}
		server.cleanupExpiredUpload(ctx, id)
	}
}

func expiredUploadIDs(directory string, entries []os.DirEntry) []string {
	seen := make(map[string]struct{})
	ids := make([]string, 0)
	for _, entry := range entries {
		id, expired := expiredUploadID(directory, entry)
		if !expired {
			continue
		}
		if _, alreadySeen := seen[id]; alreadySeen {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

func expiredUploadID(directory string, entry os.DirEntry) (string, bool) {
	if entry.IsDir() {
		return "", false
	}
	name := entry.Name()
	id := uploadIDFromFilename(name)
	if id == "" || !isCanonicalGCEntry(directory, id, name) {
		return "", false
	}

	info, err := entry.Info()
	if err != nil || time.Since(info.ModTime()) <= uploadRetention {
		return "", false
	}
	return id, true
}

func isCanonicalGCEntry(directory, id, name string) bool {
	_, err := os.Stat(filepath.Join(directory, id+".info"))
	if err == nil {
		return name == id+".info"
	}
	return errors.Is(err, os.ErrNotExist)
}

func (server *Server) cleanupExpiredUpload(ctx context.Context, id string) {
	referenced, err := server.referenced(ctx, id)
	if err != nil {
		log.Printf("Nodo deferred cleanup for %s: %v", id, err)
		return
	}
	if referenced {
		return
	}
	if err := server.removeFiles(id); err != nil {
		log.Printf("Nodo could not remove %s: %v", id, err)
	}
}
