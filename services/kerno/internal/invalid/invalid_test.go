package invalid

// Checks that validation failures keep their sentinel and user message through wrapping
import (
	"errors"
	"fmt"
	"testing"
)

func TestInputKeepsKindAndMessage(t *testing.T) {
	kind := errors.New("invalid profile")
	err := fmt.Errorf("save profile: %w", Input(kind, "Enter a nickname."))
	if !errors.Is(err, kind) {
		t.Fatal("wrapped validation failure lost its kind")
	}
	if message, ok := Message(err); !ok || message != "Enter a nickname." {
		t.Fatalf("message = %q, %t", message, ok)
	}
	if _, ok := Message(kind); ok {
		t.Fatal("a plain error must not expose a user message")
	}
}
