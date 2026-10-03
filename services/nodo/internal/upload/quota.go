package upload

// Tracks per-owner upload usage and enforces storage quotas
import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	tusd "github.com/tus/tusd/v2/pkg/handler"
)

type reservation struct {
	owner  string
	id     string
	size   int64
	active bool
}

type usage struct {
	count int
	bytes int64
}

type indexedUpload struct {
	owner string
	size  int64
}

func loadQuotaUsage(directory string) (map[string]usage, map[string]indexedUpload, error) {
	files, err := os.ReadDir(directory)
	if err != nil {
		return nil, nil, err
	}

	used := make(map[string]usage)
	indexed := make(map[string]indexedUpload)
	for _, file := range files {
		if !strings.HasSuffix(file.Name(), ".info") {
			continue
		}
		if err := indexUploadMetadata(directory, file.Name(), used, indexed); err != nil {
			return nil, nil, err
		}
	}
	return used, indexed, nil
}

func indexUploadMetadata(directory, name string, used map[string]usage, indexed map[string]indexedUpload) error {
	path := filepath.Join(directory, name)
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read upload metadata %s: %w", name, err)
	}
	var info tusd.FileInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return fmt.Errorf("decode upload metadata %s: %w", name, err)
	}
	if info.MetaData["owner"] == "" {
		return nil
	}
	addIndexedUpload(strings.TrimSuffix(name, ".info"), info, used, indexed)
	return nil
}

func addIndexedUpload(id string, info tusd.FileInfo, used map[string]usage, indexed map[string]indexedUpload) {
	owner := info.MetaData["owner"]
	indexed[id] = indexedUpload{owner: owner, size: info.Size}
	current := used[owner]
	current.count++
	current.bytes += info.Size
	used[owner] = current
}

func (server *Server) reserve(entry *reservation, size int64) error {
	server.quotaMu.Lock()
	defer server.quotaMu.Unlock()

	current := server.pending[entry.owner]
	current.count += server.used[entry.owner].count
	current.bytes += server.used[entry.owner].bytes
	if current.count >= server.config.MaxOwnerUploads || current.bytes+size > server.config.MaxOwnerBytes {
		return errors.New("storage quota reached")
	}

	pending := server.pending[entry.owner]
	pending.count++
	pending.bytes += size
	server.pending[entry.owner] = pending
	entry.size, entry.active = size, true
	return nil
}

func (server *Server) release(entry *reservation) {
	server.quotaMu.Lock()
	defer server.quotaMu.Unlock()
	if !entry.active {
		return
	}

	server.indexCompletedUpload(entry)
	server.releasePendingUsage(entry)
	entry.active = false
}

func (server *Server) indexCompletedUpload(entry *reservation) {
	if entry.id == "" {
		return
	}

	_, err := os.Stat(filepath.Join(server.config.Directory, entry.id+".info"))
	_, indexed := server.indexed[entry.id]
	// An unreadable .info file may still occupy quota. Count it until startup reconciliation.
	if indexed || (err != nil && errors.Is(err, os.ErrNotExist)) {
		return
	}

	server.indexed[entry.id] = indexedUpload{owner: entry.owner, size: entry.size}
	used := server.used[entry.owner]
	used.count++
	used.bytes += entry.size
	server.used[entry.owner] = used
}

func (server *Server) releasePendingUsage(entry *reservation) {
	pending := server.pending[entry.owner]
	pending.count--
	pending.bytes -= entry.size
	if pending.count == 0 {
		delete(server.pending, entry.owner)
		return
	}
	server.pending[entry.owner] = pending
}
