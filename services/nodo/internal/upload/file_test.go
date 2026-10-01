package upload

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/mediaauth"
	"github.com/tus/tusd/v2/pkg/filestore"
	tusd "github.com/tus/tusd/v2/pkg/handler"
)

func TestGenericFileIsServedOnlyAsDownload(t *testing.T) {
	directory := t.TempDir()
	id := "01999111-2222-7333-8444-555555555593"
	body := "<script>alert('unsafe')</script>"
	filename := safeFilename("../../report.html")
	if filename != "report.html" || safeFilename("..\\secret\n.txt") != "secret.txt" {
		t.Fatalf("unsafe file name normalization: %q", filename)
	}
	info := tusd.FileInfo{
		ID: id, Size: int64(len(body)), Offset: int64(len(body)),
		MetaData: tusd.MetaData{"owner": "alice", "filetype": "application/octet-stream", "filename": filename},
	}
	encoded, err := json.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, id+".info"), encoded, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, id), []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	key := []byte(strings.Repeat("k", 32))
	server := &Server{config: Config{Directory: directory, MediaKey: key}, store: filestore.New(directory)}
	if err := server.process(id); err != nil {
		t.Fatal(err)
	}
	ready, err := server.readReady(id)
	if err != nil || ready.Kind != "file" || ready.Width != 0 || ready.Filename != filename {
		t.Fatalf("file metadata = %+v, %v", ready, err)
	}
	signed, err := mediaauth.SignedURL("http://localhost:8082", id, time.Now().Add(time.Minute), key)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, signed, nil)
	request.SetPathValue("id", id)
	response := httptest.NewRecorder()
	server.serveMedia(response, request)
	if response.Code != http.StatusOK || response.Body.String() != body {
		t.Fatalf("download = %d, %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") != "application/octet-stream" ||
		!strings.HasPrefix(response.Header().Get("Content-Disposition"), "attachment;") ||
		!strings.Contains(response.Header().Get("Content-Disposition"), "report.html") ||
		response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("unsafe file headers = %v", response.Header())
	}
}
