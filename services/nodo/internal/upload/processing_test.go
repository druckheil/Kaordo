package upload

// Verifies background worker cancellation and video probe validation
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

func TestVideoProbeRejectsInvalidInputs(t *testing.T) {
	valid := videoStream{Width: 1920, Height: 1080}
	for _, duration := range []string{"", "NaN", "+Inf", "-Inf", "0", "-1", "121"} {
		if err := validateUploadedVideo(videoProbeReport{Streams: []videoStream{valid}, Format: videoFormat{Duration: duration}}); err == nil {
			t.Errorf("accepted invalid duration %q", duration)
		}
	}
	for _, streams := range [][]videoStream{nil, {valid, valid}, {{Width: 0, Height: 1}}, {{Width: 3841, Height: 2160}}} {
		if err := validateUploadedVideo(videoProbeReport{Streams: streams, Format: videoFormat{Duration: "1"}}); err == nil {
			t.Errorf("accepted invalid streams %+v", streams)
		}
	}
	if err := validateUploadedVideo(videoProbeReport{Streams: []videoStream{valid}, Format: videoFormat{Duration: "120"}}); err != nil {
		t.Fatalf("rejected boundary duration: %v", err)
	}
}
