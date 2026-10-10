package upload

// Tracks per-owner upload usage and enforces storage quotas
import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"sync"

	tusd "github.com/tus/tusd/v2/pkg/handler"
)

type uploadQuota struct {
	mu         sync.Mutex
	root       *os.Root
	maxUploads int
	maxBytes   int64
	pending    map[string]usage
	used       map[string]usage
	indexed    map[string]indexedUpload
}

func newUploadQuota(root *os.Root, config Config) (*uploadQuota, error) {
	used, indexed, err := loadQuotaUsage(root)
	if err != nil {
		return nil, err
	}
	return &uploadQuota{root: root, maxUploads: config.MaxOwnerUploads,
		maxBytes: config.MaxOwnerBytes, pending: make(map[string]usage), used: used, indexed: indexed}, nil
}

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

func loadQuotaUsage(root *os.Root) (map[string]usage, map[string]indexedUpload, error) {
	files, err := fs.ReadDir(root.FS(), ".")
	if err != nil {
		return nil, nil, err
	}

	used := make(map[string]usage)
	indexed := make(map[string]indexedUpload)
	for _, file := range files {
		if !strings.HasSuffix(file.Name(), ".info") {
			continue
		}
		if err := indexUploadMetadata(root, file.Name(), used, indexed); err != nil {
			return nil, nil, err
		}
	}
	return used, indexed, nil
}

func indexUploadMetadata(root *os.Root, name string, used map[string]usage, indexed map[string]indexedUpload) error {
	data, err := root.ReadFile(name)
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

func (quota *uploadQuota) reserve(entry *reservation, size int64) error {
	quota.mu.Lock()
	defer quota.mu.Unlock()

	current := quota.pending[entry.owner]
	current.count += quota.used[entry.owner].count
	current.bytes += quota.used[entry.owner].bytes
	if current.count >= quota.maxUploads || current.bytes+size > quota.maxBytes {
		return errors.New("storage quota reached")
	}

	pending := quota.pending[entry.owner]
	pending.count++
	pending.bytes += size
	quota.pending[entry.owner] = pending
	entry.size, entry.active = size, true
	return nil
}

func (quota *uploadQuota) release(entry *reservation) {
	quota.mu.Lock()
	defer quota.mu.Unlock()
	if !entry.active {
		return
	}

	quota.indexCompletedUpload(entry)
	quota.releasePendingUsage(entry)
	entry.active = false
}

func (quota *uploadQuota) indexCompletedUpload(entry *reservation) {
	if entry.id == "" {
		return
	}

	_, err := quota.root.Stat(entry.id + ".info")
	_, indexed := quota.indexed[entry.id]
	// An unreadable .info file may still occupy quota. Count it until startup reconciliation.
	if indexed || (err != nil && errors.Is(err, os.ErrNotExist)) {
		return
	}

	quota.indexed[entry.id] = indexedUpload{owner: entry.owner, size: entry.size}
	used := quota.used[entry.owner]
	used.count++
	used.bytes += entry.size
	quota.used[entry.owner] = used
}

func (quota *uploadQuota) releasePendingUsage(entry *reservation) {
	pending := quota.pending[entry.owner]
	pending.count--
	pending.bytes -= entry.size
	if pending.count == 0 {
		delete(quota.pending, entry.owner)
		return
	}
	quota.pending[entry.owner] = pending
}

func (quota *uploadQuota) removeFiles(id string) error {
	quota.mu.Lock()
	defer quota.mu.Unlock()

	if err := removeUploadFiles(quota.root, id); err != nil {
		return err
	}
	quota.removeFromUsageIndex(id)
	return nil
}

func (quota *uploadQuota) removeFromUsageIndex(id string) {
	item, exists := quota.indexed[id]
	if !exists {
		return
	}
	used := quota.used[item.owner]
	used.count--
	used.bytes -= item.size
	if used.count == 0 {
		delete(quota.used, item.owner)
	} else {
		quota.used[item.owner] = used
	}
	delete(quota.indexed, id)
}
