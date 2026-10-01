package upload

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/mediaauth"
	"github.com/google/uuid"
	"github.com/tus/tusd/v2/pkg/filelocker"
	"github.com/tus/tusd/v2/pkg/filestore"
	tusd "github.com/tus/tusd/v2/pkg/handler"
)

const maxUploadSize = 100 * 1024 * 1024

type ownerKey struct{}
type reservationKey struct{}
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

type Config struct {
	Directory       string
	KernoURL        string
	AllowedOrigins  []string
	MediaKey        []byte
	Client          *http.Client
	MaxOwnerUploads int
	MaxOwnerBytes   int64
	// VerifyOwner is an integration seam for isolated tests.
	VerifyOwner func(context.Context, string) (string, error)
}

type Server struct {
	config  Config
	store   filestore.FileStore
	tus     *tusd.Handler
	origins map[string]bool
	jobs    chan string
	quotaMu sync.Mutex
	pending map[string]usage
	used    map[string]usage
	indexed map[string]indexedUpload
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
		data, err := os.ReadFile(filepath.Join(directory, file.Name()))
		if err != nil {
			return nil, nil, fmt.Errorf("read upload metadata %s: %w", file.Name(), err)
		}
		var info tusd.FileInfo
		if err := json.Unmarshal(data, &info); err != nil {
			return nil, nil, fmt.Errorf("decode upload metadata %s: %w", file.Name(), err)
		}
		owner := info.MetaData["owner"]
		if owner == "" {
			continue
		}
		id := strings.TrimSuffix(file.Name(), ".info")
		indexed[id] = indexedUpload{owner: owner, size: info.Size}
		current := used[owner]
		current.count++
		current.bytes += info.Size
		used[owner] = current
	}
	return used, indexed, nil
}

func NewHandler(config Config) (http.Handler, error) {
	if config.Directory == "" || len(config.MediaKey) != 32 {
		return nil, errors.New("Nodo data directory and 32-byte media key are required")
	}
	if config.KernoURL == "" && config.VerifyOwner == nil {
		return nil, errors.New("Kerno internal URL is required")
	}
	if err := os.MkdirAll(config.Directory, 0700); err != nil {
		return nil, err
	}
	absoluteDirectory, err := filepath.Abs(config.Directory)
	if err != nil {
		return nil, err
	}
	config.Directory = absoluteDirectory
	if config.MaxOwnerUploads == 0 {
		config.MaxOwnerUploads = 200
	}
	if config.MaxOwnerBytes == 0 {
		config.MaxOwnerBytes = 2 * 1024 * 1024 * 1024
	}
	if config.MaxOwnerUploads < 1 || config.MaxOwnerBytes < maxUploadSize {
		return nil, errors.New("Nodo owner quota configuration is invalid")
	}
	used, indexed, err := loadQuotaUsage(config.Directory)
	if err != nil {
		return nil, err
	}
	store := filestore.New(config.Directory)
	store.DirModePerm = 0700
	store.FileModePerm = 0600
	composer := tusd.NewStoreComposer()
	store.UseIn(composer)
	filelocker.New(config.Directory).UseIn(composer)
	server := &Server{
		config: config, store: store, origins: make(map[string]bool), jobs: make(chan string, 16),
		pending: make(map[string]usage), used: used, indexed: indexed,
	}
	for _, origin := range config.AllowedOrigins {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			server.origins[trimmed] = true
		}
	}
	handler, err := tusd.NewHandler(tusd.Config{
		BasePath: "/v1/uploads/", StoreComposer: composer, MaxSize: maxUploadSize,
		DisableDownload: true, DisableTermination: true, DisableConcatenation: true,
		Cors:                    &tusd.CorsConfig{Disable: true},
		NotifyCompleteUploads:   true,
		PreUploadCreateCallback: server.beforeCreate,
	})
	if err != nil {
		return nil, err
	}
	server.tus = handler
	for range 2 {
		go server.processQueue()
	}
	go func() {
		for event := range handler.CompleteUploads {
			server.jobs <- event.Upload.ID
		}
	}()
	server.resumeCompleted()
	if config.KernoURL != "" {
		go server.cleanupLoop()
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /v1/uploads/{id}/meta", server.metadata)
	mux.Handle("/v1/uploads/", http.HandlerFunc(server.upload))
	mux.HandleFunc("GET /v1/media/{id}", server.serveMedia)
	mux.HandleFunc("DELETE /v1/media/{id}", server.purge)
	return server.cors(mux), nil
}

func (server *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if origin := r.Header.Get("Origin"); origin != "" {
			if !server.origins[origin] {
				http.Error(w, "Origin is not allowed.", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PATCH, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Tus-Resumable, Upload-Length, Upload-Offset, Upload-Metadata")
			w.Header().Set("Access-Control-Expose-Headers", "Location, Tus-Resumable, Tus-Version, Tus-Extension, Upload-Offset, Upload-Length")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func validUploadID(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed.Version() == 7 && parsed.String() == id
}

func (server *Server) identity(ctx context.Context, bearer string) (string, int) {
	if !strings.HasPrefix(bearer, "Bearer ") {
		return "", http.StatusUnauthorized
	}
	if server.config.VerifyOwner != nil {
		id, err := server.config.VerifyOwner(ctx, bearer)
		if err != nil || id == "" {
			return "", http.StatusUnauthorized
		}
		return id, http.StatusOK
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet,
		strings.TrimRight(server.config.KernoURL, "/")+"/v1/me", nil)
	if err != nil {
		return "", http.StatusServiceUnavailable
	}
	request.Header.Set("Authorization", bearer)
	client := server.config.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return "", http.StatusServiceUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized {
		return "", http.StatusUnauthorized
	}
	if response.StatusCode != http.StatusOK {
		return "", http.StatusServiceUnavailable
	}
	var user struct{ ID string }
	if err := json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&user); err != nil || user.ID == "" {
		return "", http.StatusServiceUnavailable
	}
	return user.ID, http.StatusOK
}

func (server *Server) ownerOf(ctx context.Context, id string) (tusd.FileInfo, error) {
	if !validUploadID(id) {
		return tusd.FileInfo{}, tusd.ErrNotFound
	}
	upload, err := server.store.GetUpload(ctx, id)
	if err != nil {
		return tusd.FileInfo{}, err
	}
	return upload.GetInfo(ctx)
}

func (server *Server) upload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodHead && r.Method != http.MethodPatch {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	ownerID, status := server.identity(r.Context(), r.Header.Get("Authorization"))
	if status != http.StatusOK {
		http.Error(w, "A valid Kaordo account is required.", status)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/v1/uploads/")
	if (r.Method == http.MethodPost && path != "") || (r.Method != http.MethodPost && !validUploadID(path)) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if path != "" {
		info, err := server.ownerOf(r.Context(), path)
		if err != nil || info.MetaData["owner"] != ownerID {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if server.uploadExpired(path) {
			w.WriteHeader(http.StatusGone)
			return
		}
	}
	reservation := &reservation{owner: ownerID}
	if r.Method == http.MethodPost {
		defer server.release(reservation)
	}
	ctx := context.WithValue(r.Context(), ownerKey{}, ownerID)
	ctx = context.WithValue(ctx, reservationKey{}, reservation)
	request := r.Clone(ctx)
	http.StripPrefix("/v1/uploads/", server.tus).ServeHTTP(w, request)
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
	// tusd persists the .info file before returning from a successful POST.
	// Move its reservation to the index atomically with releasing pending usage.
	if entry.id != "" {
		_, err := os.Stat(filepath.Join(server.config.Directory, entry.id+".info"))
		_, indexed := server.indexed[entry.id]
		// An unreadable .info file may still occupy quota. Count it until
		// startup reconciliation rather than admitting more uploads.
		if !indexed && (err == nil || !errors.Is(err, os.ErrNotExist)) {
			server.indexed[entry.id] = indexedUpload{owner: entry.owner, size: entry.size}
			used := server.used[entry.owner]
			used.count++
			used.bytes += entry.size
			server.used[entry.owner] = used
		}
	}
	pending := server.pending[entry.owner]
	pending.count--
	pending.bytes -= entry.size
	if pending.count == 0 {
		delete(server.pending, entry.owner)
	} else {
		server.pending[entry.owner] = pending
	}
	entry.active = false
}

func (server *Server) beforeCreate(event tusd.HookEvent) (tusd.HTTPResponse, tusd.FileInfoChanges, error) {
	ownerID, ok := event.Context.Value(ownerKey{}).(string)
	if !ok || ownerID == "" {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, tusd.NewError("ERR_UNAUTHORIZED", "account required", http.StatusUnauthorized)
	}
	info := event.Upload
	mediaType := info.MetaData["filetype"]
	if info.SizeIsDeferred || info.Size <= 0 || info.IsPartial || info.IsFinal {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, tusd.NewError("ERR_INVALID_MEDIA", "a known file size is required", http.StatusBadRequest)
	}
	if ((mediaType == "image/jpeg" || mediaType == "image/png" || mediaType == "image/webp") && info.Size > 20*1024*1024) ||
		((mediaType == "video/mp4" || mediaType == "video/webm" || mediaType == "video/quicktime" || mediaType == "application/octet-stream") && info.Size > maxUploadSize) {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, tusd.ErrMaxSizeExceeded
	}
	if mediaType != "image/jpeg" && mediaType != "image/png" && mediaType != "image/webp" && mediaType != "video/mp4" && mediaType != "video/webm" && mediaType != "video/quicktime" && mediaType != "application/octet-stream" {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, tusd.NewError("ERR_UNSUPPORTED_MEDIA", "JPEG, PNG, WebP, MP4, WebM, MOV or file upload required", http.StatusUnsupportedMediaType)
	}
	id, err := uuid.NewV7()
	if err != nil {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, err
	}
	entry, ok := event.Context.Value(reservationKey{}).(*reservation)
	if !ok || entry.owner != ownerID {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, errors.New("upload reservation is missing")
	}
	if err := server.reserve(entry, info.Size); err != nil {
		return tusd.HTTPResponse{}, tusd.FileInfoChanges{}, tusd.NewError("ERR_STORAGE_QUOTA", "Storage quota reached.", http.StatusInsufficientStorage)
	}
	entry.id = id.String()
	return tusd.HTTPResponse{}, tusd.FileInfoChanges{
		ID: id.String(), MetaData: tusd.MetaData{"owner": ownerID, "filetype": mediaType, "filename": safeFilename(info.MetaData["filename"])},
	}, nil
}

func safeFilename(value string) string {
	value = strings.ReplaceAll(value, "\\", "/")
	value = filepath.Base(value)
	value = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, value))
	if value == "." || value == "" {
		return "download"
	}
	if utf8.RuneCountInString(value) > 120 {
		value = string([]rune(value)[:120])
	}
	return value
}

func (server *Server) metadata(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ownerID, status := server.identity(r.Context(), r.Header.Get("Authorization"))
	if status != http.StatusOK {
		http.Error(w, "A valid Kaordo account is required.", status)
		return
	}
	info, err := server.ownerOf(r.Context(), id)
	if err != nil || info.MetaData["owner"] != ownerID {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if server.uploadExpired(id) {
		w.WriteHeader(http.StatusGone)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if info.Offset != info.Size {
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"complete": false})
		return
	}
	item, err := server.readReady(id)
	if err != nil {
		if _, statErr := os.Stat(server.errorPath(id)); statErr == nil {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "Media processing failed. Try another file."})
			return
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"complete": false})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id": id, "kind": item.Kind, "mimeType": item.MimeType,
		"filename": item.Filename, "width": item.Width, "height": item.Height, "size": item.Size, "complete": true,
	})
}

func (server *Server) serveMedia(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validUploadID(id) || !mediaauth.Verify(id, r.URL.Query().Get("exp"), r.URL.Query().Get("sig"), server.config.MediaKey, time.Now()) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	item, err := server.readReady(id)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	file, err := os.Open(server.displayPath(id))
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", item.MimeType)
	if item.Kind == "file" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": item.Filename}))
	} else {
		w.Header().Set("Content-Disposition", "inline")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=60")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.ServeContent(w, r, id, stat.ModTime(), file)
}

func (server *Server) processQueue() {
	for id := range server.jobs {
		if err := server.process(id); err != nil {
			log.Printf("Nodo could not process upload %s: %v", id, err)
			_ = os.WriteFile(server.errorPath(id), []byte("processing failed\n"), 0600)
		}
	}
}

func (server *Server) resumeCompleted() {
	entries, err := os.ReadDir(server.config.Directory)
	if err != nil {
		log.Printf("Nodo could not scan uploads: %v", err)
		return
	}
	go func() {
		for _, entry := range entries {
			if !strings.HasSuffix(entry.Name(), ".info") {
				continue
			}
			id := strings.TrimSuffix(entry.Name(), ".info")
			info, err := server.ownerOf(context.Background(), id)
			if err == nil && info.Offset == info.Size && info.Size > 0 {
				if _, err := server.readReady(id); err != nil {
					server.jobs <- id
				}
			}
		}
	}()
}
