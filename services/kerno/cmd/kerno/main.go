package main

// Starts Kerno by loading configuration, connecting dependencies, and serving HTTP
import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
)

const (
	regadoAgentSocket = "/run/regado-agent/agent.sock"
	metricsEndpoint   = "http://127.0.0.1:9090"
	shutdownTimeout   = 10 * time.Second
	alertInterval     = time.Minute
)

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

	pool, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := postgres.Migrate(ctx, pool); err != nil {
		return err
	}

	verify, err := newTokenVerifier(ctx, cfg)
	if err != nil {
		return err
	}

	server, closeDependencies := newHTTPServer(ctx, cfg, pool, verify)
	defer closeDependencies()
	return serve(ctx, server)
}

func serve(ctx context.Context, server *http.Server) error {
	result := make(chan error, 1)
	go func() { result <- server.ListenAndServe() }()
	slog.Info("Kerno listening", "addr", server.Addr)

	select {
	case err := <-result:
		return serveError(err)
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
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
