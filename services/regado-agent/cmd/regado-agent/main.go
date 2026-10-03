package main

// Configures the local Unix socket and starts the agent HTTP server
import (
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"time"
)

const (
	defaultSocketPath = "/run/regado-agent/agent.sock"
	socketEnvironment = "REGADO_AGENT_SOCKET"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	path := socketPath()
	listener, err := listenOnUnixSocket(path)
	if err != nil {
		return err
	}
	defer listener.Close()

	server := newHTTPServer()
	log.Printf("Regado agent listening on %s", path)
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve agent: %w", err)
	}
	return nil
}

func socketPath() string {
	if path := os.Getenv(socketEnvironment); path != "" {
		return path
	}
	return defaultSocketPath
}

func listenOnUnixSocket(path string) (net.Listener, error) {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("remove stale socket %q: %w", path, err)
	}

	listener, err := net.Listen("unix", path)
	if err != nil {
		return nil, fmt.Errorf("listen on Unix socket %q: %w", path, err)
	}
	if err := os.Chmod(path, 0660); err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("set permissions on Unix socket %q: %w", path, err)
	}
	return listener, nil
}

func newHTTPServer() *http.Server {
	return &http.Server{
		Handler:           newHandler(runCommand),
		ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      35 * time.Second,
	}
}
