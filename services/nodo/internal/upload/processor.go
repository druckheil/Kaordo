package upload

// Validates upload state, selects a media processor, and publishes processed results
import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"os"
)

type mediaInfo struct {
	Kind     string `json:"kind"`
	MimeType string `json:"mimeType"`
	Filename string `json:"filename,omitempty"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Size     int64  `json:"size"`
}

// Artifact names are relative to the data directory root
func displayName(id string) string { return id + ".display" }
func readyName(id string) string   { return id + ".ready.json" }
func errorName(id string) string   { return id + ".error" }

// createTemp is os.CreateTemp confined to the data directory root. It returns the
// relative name, because File.Name reports the full path.
func createTemp(root *os.Root, prefix string) (*os.File, string, error) {
	name := prefix + rand.Text()
	file, err := root.OpenFile(name, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	return file, name, err
}

func (server *Server) readReady(id string) (mediaInfo, error) {
	data, err := server.root.ReadFile(readyName(id))
	if err != nil {
		return mediaInfo{}, err
	}

	var item mediaInfo
	if err := json.Unmarshal(data, &item); err != nil {
		return mediaInfo{}, err
	}
	if err := validateMediaInfo(item); err != nil {
		return mediaInfo{}, err
	}
	return item, nil
}

func validateMediaInfo(item mediaInfo) error {
	if item.Size < 1 || item.Size > maxUploadSize {
		return errors.New("invalid processed media metadata")
	}

	switch item.Kind {
	case "file":
		if item.MimeType != "application/octet-stream" || item.Filename == "" || item.Width != 0 || item.Height != 0 {
			return errors.New("invalid processed media metadata")
		}
	case "image":
		if item.Width < 1 || item.Width > 8192 || item.Height < 1 || item.Height > 8192 {
			return errors.New("invalid processed media metadata")
		}
	default:
		return errors.New("invalid processed media metadata")
	}
	return nil
}

func (server *Server) process(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !validUploadID(id) {
		return errors.New("invalid upload ID")
	}
	if _, err := server.readReady(id); err == nil {
		return nil
	}

	info, err := server.ownerOf(ctx, id)
	if err != nil {
		return err
	}
	if info.Size < 1 || info.Size > maxUploadSize || info.Offset != info.Size {
		return errors.New("upload has not finished")
	}

	item, output, err := server.processSource(id, info.MetaData["filetype"], info.MetaData["filename"])
	if err != nil {
		return err
	}
	return server.publishProcessedMedia(id, item, output)
}

// processSource returns the metadata and the temporary name of the display artifact
func (server *Server) processSource(id, fileType, filename string) (mediaInfo, string, error) {
	switch fileType {
	case "image/jpeg", "image/png", "image/webp":
		return server.processImage(id, fileType)
	case "application/octet-stream":
		return server.processFile(id, filename)
	default:
		return mediaInfo{}, "", errors.New("unsupported media type")
	}
}

func (server *Server) publishProcessedMedia(id string, item mediaInfo, output string) error {
	defer server.root.Remove(output)
	if err := server.root.Rename(output, displayName(id)); err != nil {
		return err
	}
	if err := server.writeReadyMetadata(id, item); err != nil {
		return err
	}
	_ = server.root.Remove(errorName(id))
	return nil
}

func (server *Server) writeReadyMetadata(id string, item mediaInfo) error {
	data, err := json.Marshal(item)
	if err != nil {
		return err
	}

	ready, temporary, err := createTemp(server.root, id+".ready-")
	if err != nil {
		return err
	}
	defer server.root.Remove(temporary)

	if _, err := ready.Write(data); err != nil {
		_ = ready.Close()
		return err
	}
	if err := ready.Close(); err != nil {
		return err
	}
	return server.root.Rename(temporary, readyName(id))
}
