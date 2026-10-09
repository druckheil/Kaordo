// Package upload implements Nodo's tus uploads, media processing, quotas and storage maintenance.
package upload

// Removes upload artifacts and updates the per-owner usage index
import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

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
