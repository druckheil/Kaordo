package upload

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/mediaauth"
)

func TestUploadLocationUsesProxyHTTPS(t *testing.T) {
	handler, err := NewHandler(Config{
		Directory: t.TempDir(), MediaKey: []byte(strings.Repeat("k", 32)),
		VerifyOwner: func(_ context.Context, bearer string) (string, error) {
			if bearer == "Bearer alice" {
				return "alice", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(handler.Close)
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8082/v1/uploads/", nil)
	request.Header.Set("Authorization", "Bearer alice")
	request.Header.Set("Tus-Resumable", "1.0.0")
	request.Header.Set("Upload-Length", "1")
	request.Header.Set("Upload-Metadata", "filetype "+base64.StdEncoding.EncodeToString([]byte("image/png")))
	request.Header.Set("X-Forwarded-Host", "kaordo.link")
	request.Header.Set("X-Forwarded-Proto", "https")
	request.Header.Set("Forwarded", "host=attacker.example;proto=http")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("upload creation = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
	}
	location, err := url.Parse(response.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if location.Scheme != "https" || location.Host != "kaordo.link" || !strings.HasPrefix(location.Path, "/v1/uploads/") {
		t.Fatalf("upload location = %q, want https://kaordo.link/v1/uploads/<id>", location)
	}
}

func TestResumableImageUploadAndAccess(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	var referenced atomic.Bool
	kerno := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !mediaauth.VerifyInternalToken(r.Header.Get("X-Kaordo-Internal-Token"), key) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"referenced": referenced.Load()})
	}))
	defer kerno.Close()
	directory := t.TempDir()
	handler, err := NewHandler(Config{
		Directory: directory, KernoURL: kerno.URL, AllowedOrigins: []string{"http://localhost:8765"}, MediaKey: key, MaxOwnerUploads: 1,
		VerifyOwner: func(_ context.Context, bearer string) (string, error) {
			if bearer == "Bearer alice" {
				return "alice", nil
			}
			if bearer == "Bearer bob" {
				return "bob", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(handler.Close)
	server := httptest.NewServer(handler)
	defer server.Close()
	client := server.Client()

	request := func(method, path, bearer string, body io.Reader) *http.Request {
		t.Helper()
		req, err := http.NewRequest(method, server.URL+path, body)
		if err != nil {
			t.Fatal(err)
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		return req
	}
	response := func(req *http.Request, expected int) *http.Response {
		t.Helper()
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != expected {
			body, _ := io.ReadAll(res.Body)
			res.Body.Close()
			t.Fatalf("%s %s = %d, want %d: %s", req.Method, req.URL.Path, res.StatusCode, expected, body)
		}
		return res
	}

	var source bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 8, 6))
	picture.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(&source, picture); err != nil {
		t.Fatal(err)
	}
	payload := source.Bytes()
	post := request(http.MethodPost, "/v1/uploads/", "alice", nil)
	post.Header.Set("Tus-Resumable", "1.0.0")
	post.Header.Set("Upload-Length", strconv.FormatInt(int64(len(payload)), 10))
	post.Header.Set("Upload-Metadata", "filetype "+base64.StdEncoding.EncodeToString([]byte("image/png")))
	created := response(post, http.StatusCreated)
	location := created.Header.Get("Location")
	created.Body.Close()
	parsed, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	path := parsed.Path
	id := strings.TrimPrefix(path, "/v1/uploads/")
	if !validUploadID(id) {
		t.Fatalf("invalid upload ID: %q", id)
	}
	full := request(http.MethodPost, "/v1/uploads/", "alice", nil)
	full.Header = post.Header.Clone()
	quota := response(full, http.StatusInsufficientStorage)
	quota.Body.Close()
	denied := response(request(http.MethodHead, path, "bob", nil), http.StatusNotFound)
	denied.Body.Close()
	patch := request(http.MethodPatch, path, "alice", bytes.NewReader(payload))
	patch.Header.Set("Tus-Resumable", "1.0.0")
	patch.Header.Set("Upload-Offset", "0")
	patch.Header.Set("Content-Type", "application/offset+octet-stream")
	patched := response(patch, http.StatusNoContent)
	patched.Body.Close()

	var metadata struct {
		Complete       bool
		Width, Height  int
		Kind, MimeType string
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		result, err := client.Do(request(http.MethodGet, path+"/meta", "alice", nil))
		if err != nil {
			t.Fatal(err)
		}
		if result.StatusCode != http.StatusOK && result.StatusCode != http.StatusAccepted {
			t.Fatalf("metadata status = %d", result.StatusCode)
		}
		if err := json.NewDecoder(result.Body).Decode(&metadata); err != nil {
			t.Fatal(err)
		}
		result.Body.Close()
		if metadata.Complete {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("image processing did not finish")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if metadata.Width != 8 || metadata.Height != 6 || metadata.Kind != "image" || metadata.MimeType != "image/png" {
		t.Fatalf("processed metadata = %+v", metadata)
	}
	unsigned := response(request(http.MethodGet, "/v1/media/"+id, "", nil), http.StatusNotFound)
	unsigned.Body.Close()
	link, err := mediaauth.SignedURL(server.URL, id, time.Now().Add(5*time.Minute), key)
	if err != nil {
		t.Fatal(err)
	}
	shown, err := client.Get(link)
	if err != nil {
		t.Fatal(err)
	}
	defer shown.Body.Close()
	if shown.StatusCode != http.StatusOK || shown.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("signed media response = %d %q", shown.StatusCode, shown.Header.Get("Content-Type"))
	}
	if _, err := png.Decode(shown.Body); err != nil {
		t.Fatal(err)
	}
	for _, status := range []int{http.StatusForbidden, http.StatusConflict, http.StatusNoContent} {
		if status == http.StatusConflict {
			referenced.Store(true)
		}
		if status == http.StatusNoContent {
			referenced.Store(false)
		}
		deletion := request(http.MethodDelete, "/v1/media/"+id, "", nil)
		if status != http.StatusForbidden {
			deletion.Header.Set("X-Kaordo-Internal-Token", mediaauth.InternalToken(key))
		}
		res := response(deletion, status)
		res.Body.Close()
	}
	if _, err := os.Stat(filepath.Join(directory, id+".info")); !os.IsNotExist(err) {
		t.Fatalf("purged upload still exists: %v", err)
	}
	again := request(http.MethodPost, "/v1/uploads/", "alice", nil)
	again.Header = post.Header.Clone()
	newUpload := response(again, http.StatusCreated)
	newUpload.Body.Close()
	restarted, err := NewHandler(Config{
		Directory: directory, KernoURL: kerno.URL, MediaKey: key, MaxOwnerUploads: 1,
		VerifyOwner: func(_ context.Context, bearer string) (string, error) {
			if bearer == "Bearer alice" {
				return "alice", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restarted.Close)
	restartedServer := httptest.NewServer(restarted)
	defer restartedServer.Close()
	restartPost, err := http.NewRequest(http.MethodPost, restartedServer.URL+"/v1/uploads/", nil)
	if err != nil {
		t.Fatal(err)
	}
	restartPost.Header = post.Header.Clone()
	restartedQuota, err := restartedServer.Client().Do(restartPost)
	if err != nil {
		t.Fatal(err)
	}
	defer restartedQuota.Body.Close()
	if restartedQuota.StatusCode != http.StatusInsufficientStorage {
		t.Fatalf("quota after restart = %d, want %d", restartedQuota.StatusCode, http.StatusInsufficientStorage)
	}
}

func TestQuotaIndexFailsClosedOnCorruptMetadata(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "broken.info"), []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := NewHandler(Config{
		Directory: directory, MediaKey: []byte(strings.Repeat("k", 32)),
		VerifyOwner: func(context.Context, string) (string, error) { return "alice", nil },
	})
	if err == nil || !strings.Contains(err.Error(), "broken.info") {
		t.Fatalf("corrupt quota metadata was accepted: %v", err)
	}
}

func TestUploadAcceptanceEndsBeforeGarbageCollection(t *testing.T) {
	directory := t.TempDir()
	id := "01999111-2222-7333-8444-555555555554"
	path := filepath.Join(directory, id+".info")
	if err := os.WriteFile(path, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	server := &Server{config: Config{Directory: directory}, root: testRoot(t, directory)}
	for _, age := range []struct {
		value   time.Duration
		expired bool
	}{
		{22 * time.Hour, false},
		{23*time.Hour + 30*time.Minute, true},
	} {
		modified := time.Now().Add(-age.value)
		if err := os.Chtimes(path, modified, modified); err != nil {
			t.Fatal(err)
		}
		if got := server.uploadExpired(id); got != age.expired {
			t.Fatalf("upload aged %s expired=%t, want %t", age.value, got, age.expired)
		}
	}
}

func TestFourConcurrentImageUploadsAcceptMislabeledWebP(t *testing.T) {
	webpBytes, err := base64.StdEncoding.DecodeString("UklGRiwAAABXRUJQVlA4TB8AAAAvAUAAAB8gEEjeHzqN+RcQFPwf3fxHZA/gBgwR/Q8BAA==")
	if err != nil {
		t.Fatal(err)
	}
	var pngSource bytes.Buffer
	if err := png.Encode(&pngSource, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}

	key := []byte(strings.Repeat("k", 32))
	handler, err := NewHandler(Config{
		Directory: t.TempDir(), MediaKey: key, MaxOwnerUploads: 4,
		VerifyOwner: func(_ context.Context, bearer string) (string, error) {
			if bearer == "Bearer alice" {
				return "alice", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(handler.Close)
	server := httptest.NewServer(handler)
	defer server.Close()
	client := server.Client()

	type upload struct {
		id      string
		payload []byte
	}
	inputs := []struct {
		payload      []byte
		declaredMIME string
	}{
		{payload: pngSource.Bytes(), declaredMIME: "image/png"},
		{payload: webpBytes, declaredMIME: "image/jpeg"},
		{payload: pngSource.Bytes(), declaredMIME: "image/png"},
		{payload: webpBytes, declaredMIME: "image/webp"},
	}
	uploads := make([]upload, 0, len(inputs))
	for _, input := range inputs {
		request, err := http.NewRequest(http.MethodPost, server.URL+"/v1/uploads/", nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Bearer alice")
		request.Header.Set("Tus-Resumable", "1.0.0")
		request.Header.Set("Upload-Length", strconv.Itoa(len(input.payload)))
		request.Header.Set("Upload-Metadata", "filetype "+base64.StdEncoding.EncodeToString([]byte(input.declaredMIME)))
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusCreated {
			body, _ := io.ReadAll(response.Body)
			response.Body.Close()
			t.Fatalf("create upload = %d: %s", response.StatusCode, body)
		}
		location, err := url.Parse(response.Header.Get("Location"))
		response.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		id := strings.TrimPrefix(location.Path, "/v1/uploads/")
		if !validUploadID(id) {
			t.Fatalf("invalid upload ID: %q", id)
		}
		uploads = append(uploads, upload{id: id, payload: input.payload})
	}

	var wait sync.WaitGroup
	errorsFound := make(chan error, len(uploads))
	for _, item := range uploads {
		wait.Add(1)
		go func(item upload) {
			defer wait.Done()
			request, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/uploads/"+item.id, bytes.NewReader(item.payload))
			if err != nil {
				errorsFound <- err
				return
			}
			request.Header.Set("Authorization", "Bearer alice")
			request.Header.Set("Tus-Resumable", "1.0.0")
			request.Header.Set("Upload-Offset", "0")
			request.Header.Set("Content-Type", "application/offset+octet-stream")
			response, err := client.Do(request)
			if err != nil {
				errorsFound <- err
				return
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusNoContent {
				errorsFound <- fmt.Errorf("PATCH upload %s = %d", item.id, response.StatusCode)
			}
		}(item)
	}
	wait.Wait()
	close(errorsFound)
	for err := range errorsFound {
		t.Error(err)
	}

	for _, item := range uploads {
		deadline := time.Now().Add(5 * time.Second)
		for {
			request, err := http.NewRequest(http.MethodGet, server.URL+"/v1/uploads/"+item.id+"/meta", nil)
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Authorization", "Bearer alice")
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			var metadata struct {
				Complete bool   `json:"complete"`
				MIMEType string `json:"mimeType"`
				Error    string `json:"error"`
			}
			decodeErr := json.NewDecoder(response.Body).Decode(&metadata)
			response.Body.Close()
			if decodeErr != nil {
				t.Fatal(decodeErr)
			}
			if response.StatusCode == http.StatusUnprocessableEntity {
				t.Fatalf("upload %s failed processing: %s", item.id, metadata.Error)
			}
			if response.StatusCode == http.StatusOK && metadata.Complete {
				if metadata.MIMEType != "image/png" {
					t.Errorf("normalized upload MIME type = %q, want image/png", metadata.MIMEType)
				}
				break
			}
			if response.StatusCode != http.StatusAccepted || time.Now().After(deadline) {
				t.Fatalf("upload %s did not finish processing: status %d", item.id, response.StatusCode)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
}

// Device-encrypted media reaches Nodo as opaque bytes that must round-trip unchanged
func TestResumableEncryptedFileUploadAndDownload(t *testing.T) {
	data := make([]byte, 64*1024)
	if _, err := rand.Read(data); err != nil {
		t.Fatal(err)
	}
	key := []byte(strings.Repeat("k", 32))
	handler, err := NewHandler(Config{
		Directory: t.TempDir(), MediaKey: key,
		VerifyOwner: func(_ context.Context, bearer string) (string, error) {
			if bearer == "Bearer alice" {
				return "alice", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(handler.Close)
	server := httptest.NewServer(handler)
	defer server.Close()
	create, err := http.NewRequest(http.MethodPost, server.URL+"/v1/uploads/", nil)
	if err != nil {
		t.Fatal(err)
	}
	create.Header.Set("Authorization", "Bearer alice")
	create.Header.Set("Tus-Resumable", "1.0.0")
	create.Header.Set("Upload-Length", strconv.Itoa(len(data)))
	create.Header.Set("Upload-Metadata", "filetype "+base64.StdEncoding.EncodeToString([]byte("application/octet-stream"))+
		",filename "+base64.StdEncoding.EncodeToString([]byte("clip.bin")))
	created, err := server.Client().Do(create)
	if err != nil {
		t.Fatal(err)
	}
	created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		t.Fatalf("create upload = %d", created.StatusCode)
	}
	location, err := url.Parse(created.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	path := location.Path
	id := strings.TrimPrefix(path, "/v1/uploads/")
	if !validUploadID(id) {
		t.Fatalf("invalid upload ID: %q", id)
	}
	patch, err := http.NewRequest(http.MethodPatch, server.URL+path, bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	patch.Header.Set("Authorization", "Bearer alice")
	patch.Header.Set("Tus-Resumable", "1.0.0")
	patch.Header.Set("Upload-Offset", "0")
	patch.Header.Set("Content-Type", "application/offset+octet-stream")
	patched, err := server.Client().Do(patch)
	if err != nil {
		t.Fatal(err)
	}
	patched.Body.Close()
	if patched.StatusCode != http.StatusNoContent {
		t.Fatalf("patch upload = %d", patched.StatusCode)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		metadata, err := http.NewRequest(http.MethodGet, server.URL+path+"/meta", nil)
		if err != nil {
			t.Fatal(err)
		}
		metadata.Header.Set("Authorization", "Bearer alice")
		result, err := server.Client().Do(metadata)
		if err != nil {
			t.Fatal(err)
		}
		if result.StatusCode == http.StatusOK {
			var item struct {
				Complete                 bool
				Width, Height            int
				Kind, MimeType, Filename string
			}
			err = json.NewDecoder(result.Body).Decode(&item)
			result.Body.Close()
			if err != nil || !item.Complete || item.Kind != "file" || item.MimeType != "application/octet-stream" ||
				item.Filename != "clip.bin" || item.Width != 0 || item.Height != 0 {
				t.Fatalf("stored file metadata = %+v, %v", item, err)
			}
			break
		}
		result.Body.Close()
		if result.StatusCode != http.StatusAccepted || time.Now().After(deadline) {
			t.Fatalf("file processing status = %d", result.StatusCode)
		}
		time.Sleep(20 * time.Millisecond)
	}
	link, err := mediaauth.SignedURL(server.URL, id, time.Now().Add(5*time.Minute), key)
	if err != nil {
		t.Fatal(err)
	}
	shown, err := server.Client().Get(link)
	if err != nil {
		t.Fatal(err)
	}
	defer shown.Body.Close()
	if shown.StatusCode != http.StatusOK || shown.Header.Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("signed download response = %d %q", shown.StatusCode, shown.Header.Get("Content-Type"))
	}
	if body, err := io.ReadAll(shown.Body); err != nil || !bytes.Equal(body, data) {
		t.Fatalf("downloaded bytes differ from the upload: %v", err)
	}
}

func TestOldUnreferencedUploadIsCollected(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	directory := t.TempDir()
	id := "01999111-2222-7333-8444-555555555553"
	for _, suffix := range []string{"", ".info", ".display", ".ready.json"} {
		if err := os.WriteFile(filepath.Join(directory, id+suffix), []byte("test"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-25 * time.Hour)
	if err := os.Chtimes(filepath.Join(directory, id+".info"), old, old); err != nil {
		t.Fatal(err)
	}
	var referenced atomic.Bool
	kerno := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]bool{"referenced": referenced.Load()})
	}))
	defer kerno.Close()
	server := &Server{config: Config{Directory: directory, KernoURL: kerno.URL, MediaKey: key}, root: testRoot(t, directory), quota: &uploadQuota{root: testRoot(t, directory)}}
	referenced.Store(true)
	server.garbageCollect(context.Background())
	if _, err := os.Stat(filepath.Join(directory, id+".info")); err != nil {
		t.Fatalf("referenced upload was removed: %v", err)
	}
	referenced.Store(false)
	server.garbageCollect(context.Background())
	for _, suffix := range []string{"", ".info", ".display", ".ready.json"} {
		if _, err := os.Stat(filepath.Join(directory, id+suffix)); !os.IsNotExist(err) {
			t.Fatalf("stale upload file %q still exists: %v", suffix, err)
		}
	}
}

func TestCleanupFailsClosedOnMissingReferenceState(t *testing.T) {
	directory := t.TempDir()
	id := "01999111-2222-7333-8444-555555555554"
	path := filepath.Join(directory, id)
	if err := os.WriteFile(path, []byte("orphan source"), 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-25 * time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	kerno := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{}`))
	}))
	defer kerno.Close()
	server := &Server{config: Config{Directory: directory, KernoURL: kerno.URL, MediaKey: []byte(strings.Repeat("k", 32))}, root: testRoot(t, directory), quota: &uploadQuota{root: testRoot(t, directory)}}
	server.garbageCollect(context.Background())
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("source was removed without an explicit reference decision: %v", err)
	}
}

func TestOrphanSourceWithoutMetadataIsCollected(t *testing.T) {
	directory := t.TempDir()
	id := "01999111-2222-7333-8444-555555555555"
	path := filepath.Join(directory, id)
	if err := os.WriteFile(path, []byte("orphan source"), 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-25 * time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	kerno := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]bool{"referenced": false})
	}))
	defer kerno.Close()
	server := &Server{config: Config{Directory: directory, KernoURL: kerno.URL, MediaKey: []byte(strings.Repeat("k", 32))}, root: testRoot(t, directory), quota: &uploadQuota{root: testRoot(t, directory)}}
	server.garbageCollect(context.Background())
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("orphan source still exists: %v", err)
	}
}

func TestOrphanDisplayWithoutMetadataIsCollected(t *testing.T) {
	directory := t.TempDir()
	id := "01999111-2222-7333-8444-555555555556"
	path := filepath.Join(directory, id+".display")
	if err := os.WriteFile(path, []byte("orphan display"), 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-25 * time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	kerno := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]bool{"referenced": false})
	}))
	defer kerno.Close()
	server := &Server{config: Config{Directory: directory, KernoURL: kerno.URL, MediaKey: []byte(strings.Repeat("k", 32))}, root: testRoot(t, directory), quota: &uploadQuota{root: testRoot(t, directory)}}
	server.garbageCollect(context.Background())
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("orphan display still exists: %v", err)
	}
}
