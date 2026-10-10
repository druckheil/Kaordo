package upload

// Verifies that closing the handler stops background processing
import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestHandlerCloseStopsBackgroundWorkers(t *testing.T) {
	handler, err := NewHandler(Config{
		Directory: t.TempDir(), MediaKey: []byte(strings.Repeat("k", 32)),
		VerifyOwner: func(context.Context, string) (string, error) { return "alice", nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	closed := make(chan struct{})
	go func() {
		handler.Close()
		handler.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("background workers did not stop")
	}
	if err := handler.process(handler.ctx, "01999111-2222-7333-8444-555555555599"); !errors.Is(err, context.Canceled) {
		t.Fatalf("closed handler accepted processing: %v", err)
	}
}
