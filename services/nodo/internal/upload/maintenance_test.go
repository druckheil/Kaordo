package upload

// Verifies artifact classification, authenticated maintenance, and deletion safeguards
import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/mediaauth"
)

func maintenanceFixture(t *testing.T, references http.HandlerFunc) *Server {
	t.Helper()
	kerno := httptest.NewServer(references)
	t.Cleanup(kerno.Close)
	ctx, cancel := context.WithCancel(context.Background())
	directory := t.TempDir()
	root := testRoot(t, directory)
	server := &Server{config: Config{Directory: directory, KernoURL: kerno.URL, MediaKey: []byte(strings.Repeat("k", 32))},
		root: root, quota: &uploadQuota{root: root}, ctx: ctx, cancel: cancel}
	server.handler = server.routes()
	t.Cleanup(server.Close)
	return server
}

func storeMaintenanceUpload(t *testing.T, server *Server, id string, age time.Duration) {
	t.Helper()
	for _, suffix := range []string{"", ".info", ".display", ".ready.json"} {
		path := filepath.Join(server.config.Directory, id+suffix)
		if err := os.WriteFile(path, []byte("test"), 0600); err != nil {
			t.Fatal(err)
		}
		when := time.Now().Add(-age)
		if err := os.Chtimes(path, when, when); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMaintenanceClassifiesOrphansAndPreservesFreshReferencedAndUnknownFiles(t *testing.T) {
	used := "01999111-2222-7333-8444-555555555551"
	orphan := "01999111-2222-7333-8444-555555555552"
	fresh := "01999111-2222-7333-8444-555555555553"
	server := maintenanceFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if !mediaauth.VerifyInternalToken(r.Header.Get("X-Kaordo-Internal-Token"), []byte(strings.Repeat("k", 32))) {
			w.WriteHeader(403)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"referenced": strings.Contains(r.URL.Path, used)})
	})
	storeMaintenanceUpload(t, server, used, 25*time.Hour)
	storeMaintenanceUpload(t, server, orphan, 25*time.Hour)
	storeMaintenanceUpload(t, server, fresh, time.Hour)
	unknown := filepath.Join(server.config.Directory, "unrecognized-file")
	if err := os.WriteFile(unknown, []byte("retain"), 0600); err != nil {
		t.Fatal(err)
	}
	check, err := server.auditStorage(context.Background(), false)
	if err != nil || check.Files != 13 || check.SurplusFiles != 4 || check.UnverifiedFiles != 1 || check.SurplusBytes != 16 {
		t.Fatalf("check = %+v / %v", check, err)
	}
	if _, err := os.Stat(filepath.Join(server.config.Directory, displayName(orphan))); err != nil {
		t.Fatal("read-only check removed files")
	}
	repaired, err := server.auditStorage(context.Background(), true)
	if err != nil || repaired.RemovedFiles != 4 || repaired.RemovedBytes != 16 {
		t.Fatalf("repair = %+v / %v", repaired, err)
	}
	for _, path := range []string{filepath.Join(server.config.Directory, displayName(used)), filepath.Join(server.config.Directory, displayName(fresh)), unknown} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("protected file removed: %s", path)
		}
	}
	if _, err := os.Stat(filepath.Join(server.config.Directory, displayName(orphan))); !os.IsNotExist(err) {
		t.Fatal("expired orphan not removed")
	}
}

func TestMaintenanceRetainsFilesOnReferenceFailureOrFreshReference(t *testing.T) {
	id := "01999111-2222-7333-8444-555555555552"
	for _, test := range []struct {
		name        string
		unavailable bool
	}{{"unavailable", true}, {"reference added before deletion", false}} {
		t.Run(test.name, func(t *testing.T) {
			var calls atomic.Int32
			server := maintenanceFixture(t, func(w http.ResponseWriter, _ *http.Request) {
				if test.unavailable {
					w.WriteHeader(503)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]bool{"referenced": calls.Add(1) >= 2})
			})
			storeMaintenanceUpload(t, server, id, 25*time.Hour)
			report, err := server.auditStorage(context.Background(), true)
			if test.unavailable && (err == nil || report.UnverifiedFiles != 4) {
				t.Fatalf("failed reference check = %+v / %v", report, err)
			}
			if report.RemovedFiles != 0 {
				t.Fatal("uncertain upload deleted")
			}
			if _, err := os.Stat(filepath.Join(server.config.Directory, displayName(id))); err != nil {
				t.Fatal("surviving file removed")
			}
		})
	}
}

func TestMaintenanceNoticesMissingMediaAndRechecksFreshness(t *testing.T) {
	id := "01999111-2222-7333-8444-555555555552"
	var server *Server
	server = maintenanceFixture(t, func(w http.ResponseWriter, _ *http.Request) {
		// A refreshed metadata file must prevent collection even after an unreferenced response.
		now := time.Now()
		_ = os.Chtimes(filepath.Join(server.config.Directory, id+".info"), now, now)
		_ = json.NewEncoder(w).Encode(map[string]bool{"referenced": false})
	})
	storeMaintenanceUpload(t, server, id, 25*time.Hour)
	if removed, err := server.removeIfUnreferenced(context.Background(), id); err != nil || removed {
		t.Fatalf("freshness recheck = %t / %v", removed, err)
	}
	if err := os.Remove(filepath.Join(server.config.Directory, displayName(id))); err != nil {
		t.Fatal(err)
	}
	report, err := server.auditStorage(context.Background(), false)
	if err != nil || report.MissingFiles != 1 || report.UnverifiedFiles != 3 || report.SurplusFiles != 0 {
		t.Fatalf("missing media = %+v / %v", report, err)
	}
}

func TestStorageMaintenanceRequiresInternalAuthAndRunsOutsideRequests(t *testing.T) {
	entered := make(chan struct{})
	server := maintenanceFixture(t, func(_ http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
	})
	storeMaintenanceUpload(t, server, "01999111-2222-7333-8444-555555555552", 25*time.Hour)
	for _, route := range []struct{ method, path string }{{"GET", "/v1/internal/storage/maintenance"}, {"POST", "/v1/internal/storage/maintenance/check"}} {
		response := httptest.NewRecorder()
		server.ServeHTTP(response, httptest.NewRequest(route.method, route.path, nil))
		if response.Code != 403 {
			t.Fatalf("unauthorized %s = %d", route.path, response.Code)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest("POST", "/v1/internal/storage/maintenance/check", nil).WithContext(ctx)
	request.Header.Set("X-Kaordo-Internal-Token", mediaauth.InternalToken(server.config.MediaKey))
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != 202 {
		t.Fatalf("start = %d", response.Code)
	}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("background check did not start")
	}
	cancel()
	response = httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != 409 {
		t.Fatalf("concurrent maintenance = %d", response.Code)
	}
	server.Close()
	server.maintenanceMu.Lock()
	report := server.maintenance
	server.maintenanceMu.Unlock()
	if report.State != "failed" || report.RemovedFiles != 0 {
		t.Fatalf("interrupted operation = %+v", report)
	}
}
