package upload

// Configures the Nodo upload server, tusd store, background workers, and routes
import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/tus/tusd/v2/pkg/filelocker"
	"github.com/tus/tusd/v2/pkg/filestore"
	tusd "github.com/tus/tusd/v2/pkg/handler"
)

const maxUploadSize = 100 * 1024 * 1024

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
	ctx     context.Context
	cancel  context.CancelFunc
	workers sync.WaitGroup
	handler http.Handler
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

func NewHandler(config Config) (*Server, error) {
	config, err := normalizeConfig(config)
	if err != nil {
		return nil, err
	}

	server, err := newServer(config)
	if err != nil {
		return nil, err
	}
	if err := server.configureTUS(); err != nil {
		return nil, err
	}
	server.ctx, server.cancel = context.WithCancel(context.Background())
	server.handler = server.routes()
	server.startBackgroundTasks()
	return server, nil
}

// Close stops background work after the HTTP server has drained active requests.
func (server *Server) Close() error {
	server.cancel()
	server.workers.Wait()
	return nil
}

func (server *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	server.handler.ServeHTTP(w, r)
}

func normalizeConfig(config Config) (Config, error) {
	if config.Directory == "" || len(config.MediaKey) != 32 {
		return Config{}, errors.New("Nodo data directory and 32-byte media key are required")
	}
	if config.KernoURL == "" && config.VerifyOwner == nil {
		return Config{}, errors.New("Kerno internal URL is required")
	}
	if err := os.MkdirAll(config.Directory, 0700); err != nil {
		return Config{}, err
	}
	absoluteDirectory, err := filepath.Abs(config.Directory)
	if err != nil {
		return Config{}, err
	}
	config.Directory = absoluteDirectory
	applyQuotaDefaults(&config)
	if config.MaxOwnerUploads < 1 || config.MaxOwnerBytes < maxUploadSize {
		return Config{}, errors.New("Nodo owner quota configuration is invalid")
	}
	return config, nil
}

func applyQuotaDefaults(config *Config) {
	if config.MaxOwnerUploads == 0 {
		config.MaxOwnerUploads = 200
	}
	if config.MaxOwnerBytes == 0 {
		config.MaxOwnerBytes = 2 * 1024 * 1024 * 1024
	}
}

func newServer(config Config) (*Server, error) {
	used, indexed, err := loadQuotaUsage(config.Directory)
	if err != nil {
		return nil, err
	}
	return &Server{
		config:  config,
		origins: configuredOrigins(config.AllowedOrigins),
		jobs:    make(chan string, 16),
		pending: make(map[string]usage),
		used:    used,
		indexed: indexed,
	}, nil
}

func configuredOrigins(origins []string) map[string]bool {
	allowed := make(map[string]bool, len(origins))
	for _, origin := range origins {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			allowed[trimmed] = true
		}
	}
	return allowed
}

func (server *Server) configureTUS() error {
	store := filestore.New(server.config.Directory)
	store.DirModePerm = 0700
	store.FileModePerm = 0600

	composer := tusd.NewStoreComposer()
	store.UseIn(composer)
	filelocker.New(server.config.Directory).UseIn(composer)
	handler, err := tusd.NewHandler(tusd.Config{
		BasePath: "/v1/uploads/", StoreComposer: composer, MaxSize: maxUploadSize,
		DisableDownload: true, DisableTermination: true, DisableConcatenation: true,
		RespectForwardedHeaders: true,
		Cors:                    &tusd.CorsConfig{Disable: true},
		NotifyCompleteUploads:   true,
		PreUploadCreateCallback: server.beforeCreate,
	})
	if err != nil {
		return err
	}
	server.store = store
	server.tus = handler
	return nil
}

func (server *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /v1/uploads/{id}/meta", server.metadata)
	mux.Handle("/v1/uploads/", http.HandlerFunc(server.upload))
	mux.HandleFunc("GET /v1/media/{id}", server.serveMedia)
	mux.HandleFunc("DELETE /v1/media/{id}", server.purge)
	return server.cors(mux)
}

func (server *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if !server.allowOrigin(w, r) {
			return
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (server *Server) allowOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	if !server.origins[origin] {
		http.Error(w, "Origin is not allowed.", http.StatusForbidden)
		return false
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PATCH, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Tus-Resumable, Upload-Length, Upload-Offset, Upload-Metadata")
	w.Header().Set("Access-Control-Expose-Headers", "Location, Tus-Resumable, Tus-Version, Tus-Extension, Upload-Offset, Upload-Length")
	return true
}
