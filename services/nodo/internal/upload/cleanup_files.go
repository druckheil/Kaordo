package upload

// Removes upload artifacts and updates the per-owner usage index
import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func (server *Server) removeFiles(id string) error {
	server.quotaMu.Lock()
	defer server.quotaMu.Unlock()

	if err := removeUploadFiles(server.config.Directory, id); err != nil {
		return err
	}
	server.removeFromUsageIndex(id)
	return nil
}

func removeUploadFiles(directory, id string) error {
	for _, suffix := range []string{"", ".display", ".ready.json", ".error"} {
		if err := removeIfPresent(filepath.Join(directory, id+suffix)); err != nil {
			return err
		}
	}
	if err := removeTemporaryFiles(directory, id); err != nil {
		return err
	}
	return removeIfPresent(filepath.Join(directory, id+".info"))
}

func removeTemporaryFiles(directory, id string) error {
	for _, pattern := range []string{".image-*", ".video-*.mp4", ".file-*", ".ready-*"} {
		matches, err := filepath.Glob(filepath.Join(directory, id+pattern))
		if err != nil {
			return err
		}
		for _, path := range matches {
			if err := removeIfPresent(path); err != nil {
				return err
			}
		}
	}
	return nil
}

func removeIfPresent(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (server *Server) removeFromUsageIndex(id string) {
	item, exists := server.indexed[id]
	if !exists {
		return
	}
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

func uploadIDFromFilename(name string) string {
	if len(name) < 36 {
		return ""
	}
	id, suffix := name[:36], name[36:]
	if !validUploadID(id) || (!isUploadArtifactSuffix(suffix) && !isTemporaryUploadSuffix(suffix)) {
		return ""
	}
	return id
}

func isUploadArtifactSuffix(suffix string) bool {
	switch suffix {
	case "", ".info", ".display", ".ready.json", ".error":
		return true
	default:
		return false
	}
}

func isTemporaryUploadSuffix(suffix string) bool {
	for _, prefix := range []string{".image-", ".video-", ".file-", ".ready-"} {
		if strings.HasPrefix(suffix, prefix) {
			return true
		}
	}
	return false
}
