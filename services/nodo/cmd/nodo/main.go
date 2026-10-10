// Command nodo receives resumable uploads and serves stored media bytes.
package main

// Loads Nodo configuration and serves the upload API
import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/druckheil/Kaordo/services/mediaauth"
	"github.com/druckheil/Kaordo/services/nodo/internal/upload"
)

type config struct {
	dataDirectory  string
	kernoURL       string
	allowedOrigins []string
	mediaKey       []byte
	listenAddress  string
}

func main() {
	if err := run(); err != nil {
		slog.Error("stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	handler, err := upload.NewHandler(upload.Config{
		Directory: cfg.dataDirectory, KernoURL: cfg.kernoURL,
		AllowedOrigins: cfg.allowedOrigins, MediaKey: cfg.mediaKey,
	})
	if err != nil {
		return err
	}
	defer handler.Close()
	return serve(ctx, newHTTPServer(cfg.listenAddress, handler))
}

func loadConfig() (config, error) {
	rawOrigins := os.Getenv("NODO_ALLOWED_ORIGINS")
	cfg := config{
		dataDirectory:  os.Getenv("NODO_DATA_DIR"),
		kernoURL:       os.Getenv("KERNO_INTERNAL_URL"),
		allowedOrigins: strings.Split(rawOrigins, ","),
		listenAddress:  envOrDefault("LISTEN_ADDR", "127.0.0.1:8082"),
	}
	key, err := mediaauth.ParseKey(os.Getenv("NODO_MEDIA_SIGNING_KEY"))
	if cfg.dataDirectory == "" || cfg.kernoURL == "" || rawOrigins == "" || err != nil {
		return config{}, errors.New("NODO_DATA_DIR, KERNO_INTERNAL_URL, NODO_ALLOWED_ORIGINS and NODO_MEDIA_SIGNING_KEY are required")
	}
	cfg.mediaKey = key
	return cfg, nil
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func newHTTPServer(address string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
}

func serve(ctx context.Context, server *http.Server) error {
	result := make(chan error, 1)
	go func() { result <- server.ListenAndServe() }()
	slog.Info("Nodo listening", "addr", server.Addr)

	select {
	case err := <-result:
		return serveError(err)
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			return err
		}
		return serveError(<-result)
	}
}

func serveError(err error) error {
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
