package ntfy

// Checks the request ntfy receives and that refusals become errors without the token
import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
)

func TestPushSendsTheNoticeWithHeaders(t *testing.T) {
	var got *http.Request
	var body string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		got, body = r, string(raw)
		if r.Header.Get("Authorization") != "Bearer secret-token" {
			w.WriteHeader(http.StatusForbidden)
		}
	}))
	defer server.Close()
	client := Client{Token: "secret-token", Link: "https://kaordo.link/regado/?view=storage", HTTP: server.Client()}
	notice := admin.Notice{Title: "Critical on kaordo", Message: "The pool is 93% full.", Priority: "urgent", Tags: []string{"rotating_light"}}
	if err := client.Push(context.Background(), admin.NtfyChannel{URL: server.URL + "/", Topic: "kaordo-ops-1"}, notice); err != nil {
		t.Fatal(err)
	}
	if got.Method != http.MethodPost || got.URL.Path != "/kaordo-ops-1" || body != "The pool is 93% full." {
		t.Fatalf("request = %s %s %q", got.Method, got.URL.Path, body)
	}
	for header, want := range map[string]string{"Title": "Critical on kaordo", "Priority": "urgent", "Tags": "rotating_light", "Click": client.Link} {
		if got.Header.Get(header) != want {
			t.Errorf("%s = %q", header, got.Header.Get(header))
		}
	}

	client.Token = "wrong"
	err := client.Push(context.Background(), admin.NtfyChannel{URL: server.URL, Topic: "kaordo-ops-1"}, notice)
	if err == nil || strings.Contains(err.Error(), "wrong") {
		t.Fatalf("refusal = %v", err)
	}
}
