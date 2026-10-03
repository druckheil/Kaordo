package upload

// Validates upload state, selects a media processor, and publishes processed results
import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type mediaInfo struct {
	Kind     string `json:"kind"`
	MimeType string `json:"mimeType"`
	Filename string `json:"filename,omitempty"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Size     int64  `json:"size"`
}

func (server *Server) displayPath(id string) string {
	return filepath.Join(server.config.Directory, id+".display")
}

func (server *Server) readyPath(id string) string {
	return filepath.Join(server.config.Directory, id+".ready.json")
}

func (server *Server) errorPath(id string) string {
	return filepath.Join(server.config.Directory, id+".error")
}

func (server *Server) readReady(id string) (mediaInfo, error) {
	data, err := os.ReadFile(server.readyPath(id))
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
	case "image", "video":
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

	source := filepath.Join(server.config.Directory, id)
	item, output, err := server.processSource(ctx, source, id, info.MetaData["filetype"], info.MetaData["filename"])
	if err != nil {
		return err
	}
	return server.publishProcessedMedia(id, item, output)
}

func (server *Server) processSource(ctx context.Context, source, id, fileType, filename string) (mediaInfo, string, error) {
	switch fileType {
	case "image/jpeg", "image/png", "image/webp":
		return server.processImage(source, id, fileType)
	case "video/mp4", "video/webm", "video/quicktime":
		return server.processVideo(ctx, source, id)
	case "application/octet-stream":
		return server.processFile(source, id, filename)
	default:
		return mediaInfo{}, "", errors.New("unsupported media type")
	}
}

func (server *Server) publishProcessedMedia(id string, item mediaInfo, output string) error {
	defer os.Remove(output)
	if err := os.Rename(output, server.displayPath(id)); err != nil {
		return err
	}
	if err := server.writeReadyMetadata(id, item); err != nil {
		return err
	}
	_ = os.Remove(server.errorPath(id))
	return nil
}

func (server *Server) writeReadyMetadata(id string, item mediaInfo) error {
	data, err := json.Marshal(item)
	if err != nil {
		return err
	}

	ready, err := os.CreateTemp(server.config.Directory, id+".ready-*")
	if err != nil {
		return err
	}
	defer os.Remove(ready.Name())

	if _, err := ready.Write(data); err != nil {
		_ = ready.Close()
		return err
	}
	if err := ready.Close(); err != nil {
		return err
	}
	if err := os.Rename(ready.Name(), server.readyPath(id)); err != nil {
		return err
	}
	return nil
}
