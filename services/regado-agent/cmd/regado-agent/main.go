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
	"path/filepath"
	"syscall"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/agent"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/api"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/storage"
)

const (
	defaultSocketPath = "/run/regado-agent/agent.sock"
	socketEnvironment = "REGADO_AGENT_SOCKET"
	defaultPoolMount  = "/srv/kaordo"
	defaultStateDir   = "/var/lib/regado-agent"
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

	service, closeService, err := openService(ctx)
	if err != nil {
		return err
	}
	defer closeService()
	legacy := agent.NewHandler()
	defer legacy.Close()
	server := newHTTPServer(api.NewHandler(service, legacy))
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

// openService opens the desired state and operation journal and adopts the current pool on first run
func openService(ctx context.Context) (*api.Service, func(), error) {
	directory := environment("REGADO_STATE_DIR", defaultStateDir)
	states, err := state.Open(filepath.Join(directory, "state"))
	if err != nil {
		return nil, nil, err
	}
	operations, err := operation.Open(filepath.Join(directory, "operations"), time.Now)
	if err != nil {
		states.Close()
		return nil, nil, err
	}
	described := api.DescribeHost(environment("REGADO_POOL_MOUNT", defaultPoolMount))
	service := &api.Service{
		Run: command.Run, Host: described, States: states, Operations: operations,
		Executor: storage.Executor{Run: command.Run, Mount: described.PoolMount, Poll: time.Second, EFI: described.Firmware == "efi"},
	}
	if err := service.Adopt(ctx); err != nil {
		// The API still serves facts and operations; Regado shows the adoption error from /host
		slog.Error("could not adopt the current pool", "err", err)
	}
	// Operations stop first so running jobs record interruption before the state store closes
	return service, func() { operations.Close(); states.Close() }, nil
}

func environment(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func socketPath() string {
	return environment(socketEnvironment, defaultSocketPath)
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
