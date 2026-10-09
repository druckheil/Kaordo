package agent

// Checks that only allowlisted services and actions reach host commands
import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/journal"
)

func TestActionAllowlist(t *testing.T) {
	if validService("../../etc/shadow") {
		t.Fatal("arbitrary journal unit accepted")
	}
	called := false
	handler := newHandler(func(context.Context, ...string) (string, error) { called = true; return "", nil }, journal.Policy{})
	for _, path := range []string{"/actions/restart-kerno", "/actions/reboot", "/actions/../../etc", "/actions/scrub-filesystem"} {
		request := httptest.NewRequest(http.MethodPost, path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code == http.StatusOK || called {
			t.Fatalf("unsafe action %q accepted", path)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/actions/restart-nodo", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !called {
		t.Fatalf("restart-nodo = %d, called %v", response.Code, called)
	}
}
