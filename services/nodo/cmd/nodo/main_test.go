package main

// Verifies that server shutdown waits for active requests and reports startup failures
import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestServeDrainsActiveRequest(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	entered, release, shuttingDown := make(chan struct{}), make(chan struct{}), make(chan struct{})
	server := &http.Server{Addr: address, Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(entered)
		<-release
		_, _ = io.WriteString(w, "drained")
	})}
	server.RegisterOnShutdown(func() { close(shuttingDown) })
	t.Cleanup(func() { _ = server.Close() })
	finished := make(chan error, 1)
	go func() { finished <- serve(ctx, server) }()
	response := make(chan string, 1)
	go func() {
		client := &http.Client{Timeout: 3 * time.Second}
		for deadline := time.Now().Add(time.Second); time.Now().Before(deadline); {
			res, err := client.Get("http://" + address)
			if err != nil {
				time.Sleep(time.Millisecond)
				continue
			}
			body, _ := io.ReadAll(res.Body)
			_ = res.Body.Close()
			response <- string(body)
			return
		}
		response <- "request failed"
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		close(release)
		t.Fatal("request did not reach the server")
	}
	cancel()
	<-shuttingDown
	select {
	case err := <-finished:
		close(release)
		t.Fatalf("server returned before draining the request: %v", err)
	default:
	}
	close(release)
	if body := <-response; body != "drained" {
		t.Fatalf("response = %q", body)
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
}

func TestServeReportsOccupiedPort(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if err := serve(t.Context(), &http.Server{Addr: listener.Addr().String()}); err == nil {
		t.Fatal("occupied port must fail immediately")
	}
}
