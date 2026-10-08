package main

// Starts Kerno by loading configuration, connecting dependencies, and serving HTTP
import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
)

const (
	regadoAgentSocket = "/run/regado-agent/agent.sock"
	metricsEndpoint   = "http://127.0.0.1:9090"
	shutdownTimeout   = 10 * time.Second
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
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

	if err := postgres.VerifySchema(ctx, pool); err != nil {
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
	log.Printf("Kerno listening on %s", server.Addr)

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
