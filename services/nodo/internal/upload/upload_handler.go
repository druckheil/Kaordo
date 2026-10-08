package upload

// Authenticates tus requests and reserves quota for new uploads
import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	tusd "github.com/tus/tusd/v2/pkg/handler"
)

const maxImageUploadSize = 20 * 1024 * 1024

type ownerKey struct{}
type reservationKey struct{}

func (server *Server) upload(w http.ResponseWriter, r *http.Request) {
	if !isUploadMethod(r.Method) {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	ownerID, status := server.identity(r.Context(), r.Header.Get("Authorization"))
	if status != http.StatusOK {
		http.Error(w, "A valid Kaordo account is required.", status)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/v1/uploads/")
	if status := server.uploadPathStatus(r, path, ownerID); status != http.StatusOK {
		w.WriteHeader(status)
		return
	}

	entry := &reservation{owner: ownerID}
	if r.Method == http.MethodPost {
		defer server.quota.release(entry)
	}
	request := requestWithUploadContext(r, ownerID, entry)
	http.StripPrefix("/v1/uploads/", server.tus).ServeHTTP(w, request)
}

func isUploadMethod(method string) bool {
	return method == http.MethodPost || method == http.MethodHead || method == http.MethodPatch
}

func (server *Server) uploadPathStatus(r *http.Request, path, ownerID string) int {
	if (r.Method == http.MethodPost && path != "") ||
		(r.Method != http.MethodPost && !validUploadID(path)) {
		return http.StatusNotFound
	}
	if path == "" {
		return http.StatusOK
	}

	info, err := server.ownerOf(r.Context(), path)
	if err != nil || info.MetaData["owner"] != ownerID {
		return http.StatusNotFound
	}
	if server.uploadExpired(path) {
		return http.StatusGone
	}
	return http.StatusOK
}

func requestWithUploadContext(r *http.Request, ownerID string, entry *reservation) *http.Request {
	ctx := r.Context()
	ctx = context.WithValue(ctx, ownerKey{}, ownerID)
	ctx = context.WithValue(ctx, reservationKey{}, entry)
	request := r.Clone(ctx)
	// Caddy overwrites X-Forwarded-* but passes Forwarded through unchanged.
	// tusd gives Forwarded precedence, so discard a client-supplied value.
	request.Header.Del("Forwarded")
	return request
}

func (server *Server) beforeCreate(event tusd.HookEvent) (tusd.HTTPResponse, tusd.FileInfoChanges, error) {
	ownerID, ok := event.Context.Value(ownerKey{}).(string)
	if !ok || ownerID == "" {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, tusd.NewError("ERR_UNAUTHORIZED", "account required", http.StatusUnauthorized)
	}

	info := event.Upload
	if info.SizeIsDeferred || info.Size <= 0 || info.IsPartial || info.IsFinal {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, tusd.NewError("ERR_INVALID_MEDIA", "a known file size is required", http.StatusBadRequest)
	}
	limit, supported := uploadSizeLimit(info.MetaData["filetype"])
	if !supported {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, tusd.NewError("ERR_UNSUPPORTED_MEDIA", "JPEG, PNG, WebP, MP4, WebM, MOV or file upload required", http.StatusUnsupportedMediaType)
	}
	if info.Size > limit {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, tusd.ErrMaxSizeExceeded
	}

	id, err := uuid.NewV7()
	if err != nil {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, err
	}
	entry, ok := event.Context.Value(reservationKey{}).(*reservation)
	if !ok || entry.owner != ownerID {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, errors.New("upload reservation is missing")
	}
	if err := server.quota.reserve(entry, info.Size); err != nil {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, tusd.NewError("ERR_STORAGE_QUOTA", "Storage quota reached.", http.StatusInsufficientStorage)
	}
	entry.id = id.String()
	return tusd.HTTPResponse{}, tusd.FileInfoChanges{
		ID: id.String(), MetaData: tusd.MetaData{
			"owner": ownerID, "filetype": info.MetaData["filetype"], "filename": safeFilename(info.MetaData["filename"]),
		},
	}, nil
}

func uploadSizeLimit(mediaType string) (int64, bool) {
	switch mediaType {
	case "image/jpeg", "image/png", "image/webp":
		return maxImageUploadSize, true
	case "video/mp4", "video/webm", "video/quicktime", "application/octet-stream":
		return maxUploadSize, true
	default:
		return 0, false
	}
}

func safeFilename(value string) string {
	value = strings.ReplaceAll(value, "\\", "/")
	value = filepath.Base(value)
	value = strings.TrimSpace(strings.Map(func(character rune) rune {
		if unicode.IsControl(character) {
			return -1
		}
		return character
	}, value))
	if value == "." || value == "" {
		return "download"
	}
	if utf8.RuneCountInString(value) > 120 {
		value = string([]rune(value)[:120])
	}
	return value
}
