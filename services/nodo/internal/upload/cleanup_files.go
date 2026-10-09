// Package upload implements Nodo's tus uploads, media processing, quotas and storage maintenance.
package upload

// Removes upload artifacts and recognizes which data-directory names belong to an upload
import (
	"errors"
	"io/fs"
	"os"
	"strings"
)

var temporaryArtifactPrefixes = []string{".image-", ".file-", ".ready-"}

func removeUploadFiles(root *os.Root, id string) error {
	for _, name := range []string{id, displayName(id), readyName(id), errorName(id)} {
		if err := removeIfPresent(root, name); err != nil {
			return err
		}
	}
	for _, prefix := range temporaryArtifactPrefixes {
		matches, err := fs.Glob(root.FS(), id+prefix+"*")
		if err != nil {
			return err
		}
		for _, name := range matches {
			if err := removeIfPresent(root, name); err != nil {
				return err
			}
		}
	}
	// The tus metadata goes last: garbage collection finds partial removals through it
	return removeIfPresent(root, id+".info")
}

func removeIfPresent(root *os.Root, name string) error {
	if err := root.Remove(name); err != nil && !errors.Is(err, os.ErrNotExist) {
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
	for _, prefix := range temporaryArtifactPrefixes {
		if strings.HasPrefix(suffix, prefix) {
			return true
		}
	}
	return false
}
