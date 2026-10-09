package upload

// Serves upload metadata and signed media responses
import (
	"encoding/json"
	"mime"
	"net/http"
	"os"
	"time"

	"github.com/druckheil/Kaordo/services/mediaauth"
	tusd "github.com/tus/tusd/v2/pkg/handler"
)

func (server *Server) metadata(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ownerID, status := server.identity(r.Context(), r.Header.Get("Authorization"))
	if status != http.StatusOK {
		http.Error(w, "A valid Kaordo account is required.", status)
		return
	}

	info, status := server.ownedUploadStatus(r, id, ownerID)
	if status != http.StatusOK {
		w.WriteHeader(status)
		return
	}
	setMetadataHeaders(w)
	if info.Offset != info.Size {
		writeIncompleteMetadata(w)
		return
	}

	item, err := server.readReady(id)
	if err != nil {
		writeProcessingMetadata(w, server.errorPath(id))
		return
	}
	writeCompleteMetadata(w, id, item)
}

func (server *Server) ownedUploadStatus(r *http.Request, id, ownerID string) (info tusd.FileInfo, status int) {
	info, err := server.ownerOf(r.Context(), id)
	if err != nil || info.MetaData["owner"] != ownerID {
		return tusd.FileInfo{}, http.StatusNotFound
	}
	if server.uploadExpired(id) {
		return tusd.FileInfo{}, http.StatusGone
	}
	return info, http.StatusOK
}

func setMetadataHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
}

func writeIncompleteMetadata(w http.ResponseWriter) {
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]any{"complete": false})
}

func writeProcessingMetadata(w http.ResponseWriter, errorPath string) {
	if _, err := os.Stat(errorPath); err == nil {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Media processing failed. Try another file."})
		return
	}
	writeIncompleteMetadata(w)
}

func writeCompleteMetadata(w http.ResponseWriter, id string, item mediaInfo) {
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id": id, "kind": item.Kind, "mimeType": item.MimeType,
		"filename": item.Filename, "width": item.Width, "height": item.Height, "size": item.Size, "complete": true,
	})
}

func (server *Server) serveMedia(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validMediaSignature(id, r, server.config.MediaKey) {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	item, file, stat, err := server.openReadyMedia(id)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	defer func() { _ = file.Close() }() // read-only media
	setMediaHeaders(w, item)
	http.ServeContent(w, r, id, stat.ModTime(), file)
}

func validMediaSignature(id string, r *http.Request, key []byte) bool {
	return validUploadID(id) && mediaauth.Verify(
		id,
		r.URL.Query().Get("exp"),
		r.URL.Query().Get("sig"),
		key,
		time.Now(),
	)
}

func (server *Server) openReadyMedia(id string) (mediaInfo, *os.File, os.FileInfo, error) {
	item, err := server.readReady(id)
	if err != nil {
		return mediaInfo{}, nil, nil, err
	}
	file, err := os.Open(server.displayPath(id))
	if err != nil {
		return mediaInfo{}, nil, nil, err
	}
	stat, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return mediaInfo{}, nil, nil, err
	}
	return item, file, stat, nil
}

func setMediaHeaders(w http.ResponseWriter, item mediaInfo) {
	w.Header().Set("Content-Type", item.MimeType)
	if item.Kind == "file" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": item.Filename}))
	} else {
		w.Header().Set("Content-Disposition", "inline")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=60")
	w.Header().Set("Referrer-Policy", "no-referrer")
}
