package upload

// Scans for expired, unreferenced uploads and schedules periodic cleanup
import (
	"context"
	"errors"
	"io/fs"
	"log"
	"os"
	"time"
)

const uploadRetention = 24 * time.Hour
const uploadAcceptance = uploadRetention - time.Hour

func (server *Server) uploadExpired(id string) bool {
	info, err := server.root.Stat(id + ".info")
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
	entries, err := fs.ReadDir(server.root.FS(), ".")
	if err != nil {
		log.Printf("Nodo cleanup scan failed: %v", err)
		return
	}

	for _, id := range expiredUploadIDs(server.root, entries) {
		if ctx.Err() != nil {
			return
		}
		server.cleanupExpiredUpload(ctx, id)
	}
}

func expiredUploadIDs(root *os.Root, entries []fs.DirEntry) []string {
	seen := make(map[string]struct{})
	ids := make([]string, 0)
	for _, entry := range entries {
		id, expired := expiredUploadID(root, entry)
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

func expiredUploadID(root *os.Root, entry fs.DirEntry) (string, bool) {
	if entry.IsDir() {
		return "", false
	}
	name := entry.Name()
	id := uploadIDFromFilename(name)
	if id == "" || !isCanonicalGCEntry(root, id, name) {
		return "", false
	}

	info, err := entry.Info()
	if err != nil || time.Since(info.ModTime()) <= uploadRetention {
		return "", false
	}
	return id, true
}

func isCanonicalGCEntry(root *os.Root, id, name string) bool {
	_, err := root.Stat(id + ".info")
	if err == nil {
		return name == id+".info"
	}
	return errors.Is(err, os.ErrNotExist)
}

func (server *Server) cleanupExpiredUpload(ctx context.Context, id string) {
	if _, err := server.removeIfUnreferenced(ctx, id); err != nil {
		log.Printf("Nodo deferred cleanup for %s: %v", id, err)
	}
}

func (server *Server) gcEligible(id string) (bool, error) {
	info, err := server.root.Lstat(id + ".info")
	if err == nil {
		return info.Mode().IsRegular() && time.Since(info.ModTime()) > uploadRetention, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	names, err := fs.Glob(server.root.FS(), id+"*")
	if err != nil {
		return false, err
	}
	found := false
	for _, name := range names {
		if uploadIDFromFilename(name) != id {
			continue
		}
		info, err := server.root.Lstat(name)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return false, err
		}
		if !info.Mode().IsRegular() || time.Since(info.ModTime()) <= uploadRetention {
			return false, nil
		}
		found = true
	}
	return found, nil
}
