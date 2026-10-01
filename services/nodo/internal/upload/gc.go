package upload

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/mediaauth"
)

const uploadRetention = 24 * time.Hour
const uploadAcceptance = uploadRetention - time.Hour

func (server *Server) uploadExpired(id string) bool {
	info, err := os.Stat(filepath.Join(server.config.Directory, id+".info"))
	// Stop accepting a file before garbage collection can remove unclaimed
	// bytes. Kerno has time to commit its media claim after validation.
	return err != nil || time.Since(info.ModTime()) > uploadAcceptance
}

func (server *Server) referenced(ctx context.Context, id string) (bool, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet,
		strings.TrimRight(server.config.KernoURL, "/")+"/v1/internal/media/"+id+"/referenced", nil)
	if err != nil {
		return false, err
	}
	request.Header.Set("X-Kaordo-Internal-Token", mediaauth.InternalToken(server.config.MediaKey))
	client := server.config.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false, errors.New("Kerno reference check failed")
	}
	var result struct {
		Referenced *bool `json:"referenced"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 256)).Decode(&result); err != nil {
		return false, err
	}
	if result.Referenced == nil {
		return false, errors.New("Kerno reference response is missing referenced state")
	}
	return *result.Referenced, nil
}

func (server *Server) removeFiles(id string) error {
	server.quotaMu.Lock()
	defer server.quotaMu.Unlock()
	for _, suffix := range []string{"", ".display", ".ready.json", ".error"} {
		if err := os.Remove(filepath.Join(server.config.Directory, id+suffix)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	for _, pattern := range []string{".image-*", ".video-*.mp4", ".file-*", ".ready-*"} {
		matches, err := filepath.Glob(filepath.Join(server.config.Directory, id+pattern))
		if err != nil {
			return err
		}
		for _, file := range matches {
			if err := os.Remove(file); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	if err := os.Remove(filepath.Join(server.config.Directory, id+".info")); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if item, exists := server.indexed[id]; exists {
		used := server.used[item.owner]
		used.count--
		used.bytes -= item.size
		if used.count == 0 {
			delete(server.used, item.owner)
		} else {
			server.used[item.owner] = used
		}
		delete(server.indexed, id)
	}
	return nil
}

func uploadIDFromFilename(name string) string {
	if len(name) < 36 {
		return ""
	}
	id, suffix := name[:36], name[36:]
	if !validUploadID(id) {
		return ""
	}
	switch suffix {
	case "", ".info", ".display", ".ready.json", ".error":
		return id
	default:
		if strings.HasPrefix(suffix, ".image-") || strings.HasPrefix(suffix, ".video-") || strings.HasPrefix(suffix, ".file-") || strings.HasPrefix(suffix, ".ready-") {
			return id
		}
		return ""
	}
}

func (server *Server) purge(w http.ResponseWriter, r *http.Request) {
	if !mediaauth.VerifyInternalToken(r.Header.Get("X-Kaordo-Internal-Token"), server.config.MediaKey) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	id := r.PathValue("id")
	if !validUploadID(id) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	referenced, err := server.referenced(r.Context(), id)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if referenced {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err := server.removeFiles(id); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (server *Server) cleanupLoop() {
	server.garbageCollect(context.Background())
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		server.garbageCollect(context.Background())
	}
}

func (server *Server) garbageCollect(ctx context.Context) {
	entries, err := os.ReadDir(server.config.Directory)
	if err != nil {
		log.Printf("Nodo cleanup scan failed: %v", err)
		return
	}
	seen := make(map[string]bool)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		id := uploadIDFromFilename(name)
		if id == "" || seen[id] {
			continue
		}
		if _, err := os.Stat(filepath.Join(server.config.Directory, id+".info")); err == nil {
			if name != id+".info" {
				continue
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			continue
		}
		info, statErr := entry.Info()
		if statErr != nil || time.Since(info.ModTime()) <= uploadRetention {
			continue
		}
		seen[id] = true
		referenced, err := server.referenced(ctx, id)
		if err != nil {
			log.Printf("Nodo deferred cleanup for %s: %v", id, err)
			continue
		}
		if referenced {
			continue
		}
		if err := server.removeFiles(id); err != nil {
			log.Printf("Nodo could not remove %s: %v", id, err)
		}
	}
}
