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
	"sync"
	"syscall"
	"time"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/agent"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/alert"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/api"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/command"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/deployment"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/integrity"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/journal"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/state"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/storage"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/usage"
)

const (
	defaultSocketPath = "/run/regado-agent/agent.sock"
	socketEnvironment = "REGADO_AGENT_SOCKET"
	defaultPoolMount  = "/srv/kaordo"
	defaultStateDir   = "/var/lib/regado-agent"
	healthInterval    = 15 * time.Minute
	alertInterval     = time.Minute
	usageInterval     = time.Hour
	scheduleInterval  = 10 * time.Minute
	// Scrub limit per device keeps services responsive while every copy is read
	scrubLimit = "64m"
)

// maintenanceWindow is the local hour range in which scheduled checks may start
var maintenanceWindow = [2]int{2, 6}

func main() {
	if err := run(); err != nil {
		slog.Error("stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	path := socketPath()
	listener, err := listenOnUnixSocket(ctx, path)
	if err != nil {
		return err
	}
	defer listener.Close()

	directory := environment("REGADO_STATE_DIR", defaultStateDir)
	service, closeService, err := openService(ctx, directory)
	if err != nil {
		return err
	}
	defer closeService()
	// Background readers stop before the service closes, even when serving fails
	watch, stopWatching := context.WithCancel(ctx)
	var watchers sync.WaitGroup
	defer watchers.Wait()
	defer stopWatching()
	watchers.Go(func() { service.WatchHealth(watch, healthInterval) })
	watchers.Go(func() { service.WatchAlerts(watch, alertInterval) })
	watchers.Go(func() { service.Usage.Watch(watch, usageInterval) })
	scheduler := &integrity.Scheduler{
		Operations: service.Operations, States: service.States, Request: service.IntegrityRequest,
		Now: time.Now, Window: maintenanceWindow,
	}
	watchers.Go(func() { scheduler.Run(watch, scheduleInterval) })
	server := newHTTPServer(api.NewHandler(service, agent.NewHandler(service.Journal)))
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
func openService(ctx context.Context, directory string) (*api.Service, func(), error) {
	states, err := state.Open(filepath.Join(directory, "state"))
	if err != nil {
		return nil, nil, err
	}
	operations, err := operation.Open(filepath.Join(directory, "operations"), time.Now)
	if err != nil {
		states.Close()
		return nil, nil, err
	}
	alerts, err := alert.Open(filepath.Join(directory, "alerts"))
	if err != nil {
		operations.Close()
		states.Close()
		return nil, nil, err
	}
	poolMount := environment("REGADO_POOL_MOUNT", defaultPoolMount)
	usages, err := usage.Open(filepath.Join(directory, "usage"), command.Run, poolMount, usage.Areas(poolMount), time.Now)
	if err != nil {
		alerts.Close()
		operations.Close()
		states.Close()
		return nil, nil, err
	}
	described := api.DescribeHost(poolMount)
	service := &api.Service{
		Run: command.Run, Host: described, States: states, Operations: operations, Alerts: alerts, Usage: usages,
		Executor:  storage.Executor{Run: command.Run, Mount: described.PoolMount, Poll: time.Second, EFI: described.Firmware == "efi"},
		Integrity: integrity.Checker{Run: command.Run, Mount: described.PoolMount, Poll: 5 * time.Second, ScrubLimit: scrubLimit},
		Journal:   journal.Policy{Link: journal.DefaultLink, Path: filepath.Join(directory, "journald-retention.conf")},

		DeploymentState: environment("REGADO_DEPLOYMENT_STATE", deployment.DefaultDirectory),
	}
	// Hosts with the system in the pool give every new member the bootloader
	if storage.RootOnPool(ctx, command.Run, described.PoolMount) && !service.Executor.EFI {
		service.Executor.Boot = storage.GRUB{Run: command.Run, Directory: "/boot"}
	}
	if err := service.Adopt(ctx); err != nil {
		// The API still serves facts and operations; Regado shows the adoption error from /host
		slog.Error("could not adopt the current pool", "err", err)
	}
	if err := service.ReconcileJournal(ctx); err != nil {
		slog.Error("could not reconcile the journal retention", "err", err)
	}
	// Operations stop first so running jobs record interruption before the state store closes
	return service, func() { operations.Close(); usages.Close(); alerts.Close(); states.Close() }, nil
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
