// Command regado-agent exposes fixed host operations to Kerno over a protected Unix socket.
package main

// Configures the local Unix socket and starts the agent HTTP server
import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/agent"
)

const (
	defaultSocketPath = "/run/regado-agent/agent.sock"
	socketEnvironment = "REGADO_AGENT_SOCKET"
)

func main() {
	if err := run(); err != nil {
		slog.Error("stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) == 2 && os.Args[1] == "--mount-system-volumes" {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		return agent.MountSystemVolumes(ctx)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	path := socketPath()
	listener, err := listenOnUnixSocket(ctx, path)
	if err != nil {
		return err
	}
	defer listener.Close()

	handler := agent.NewHandler()
	defer handler.Close()
	server := newHTTPServer(handler)
	slog.Info("Regado agent listening", "socket", path)
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	select {
	case err := <-served:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve agent: %w", err)
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
			return err
		}
		if err := <-served; err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	return nil
}

func socketPath() string {
	if path := os.Getenv(socketEnvironment); path != "" {
		return path
	}
	return defaultSocketPath
}

func listenOnUnixSocket(ctx context.Context, path string) (net.Listener, error) {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("remove stale socket %q: %w", path, err)
	}

	listener, err := (&net.ListenConfig{}).Listen(ctx, "unix", path)
	if err != nil {
		return nil, fmt.Errorf("listen on Unix socket %q: %w", path, err)
	}
	// Kerno connects through the socket group; other users have no access
	if err := os.Chmod(path, 0660); err != nil { //nolint:gosec // group access is the socket's authorization boundary
		_ = listener.Close()
		return nil, fmt.Errorf("set permissions on Unix socket %q: %w", path, err)
	}
	return listener, nil
}

func newHTTPServer(handler http.Handler) *http.Server {
	return &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      35 * time.Second,
	}
}
