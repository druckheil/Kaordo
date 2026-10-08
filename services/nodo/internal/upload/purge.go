package upload

// Checks Kerno media references and handles authenticated purge requests
import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/mediaauth"
)

func (server *Server) referenced(ctx context.Context, id string) (bool, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet,
		strings.TrimRight(server.config.KernoURL, "/")+"/v1/internal/media/"+id+"/referenced", nil)
	if err != nil {
		return false, err
	}
	request.Header.Set("X-Kaordo-Internal-Token", mediaauth.InternalToken(server.config.MediaKey))

	client := server.config.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return false, errors.New("Kerno reference check failed")
	}
	return decodeReferenceStatus(response.Body)
}

func decodeReferenceStatus(body io.Reader) (bool, error) {
	var result struct {
		Referenced *bool `json:"referenced"`
	}
	if err := json.NewDecoder(io.LimitReader(body, 256)).Decode(&result); err != nil {
		return false, err
	}
	if result.Referenced == nil {
		return false, errors.New("Kerno reference response is missing referenced state")
	}
	return *result.Referenced, nil
}

func (server *Server) purge(w http.ResponseWriter, r *http.Request) {
	if !mediaauth.VerifyInternalToken(r.Header.Get("X-Kaordo-Internal-Token"), server.config.MediaKey) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	id := r.PathValue("id")
	if !validUploadID(id) {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	referenced, err := server.referenced(r.Context(), id)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if referenced {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err := server.quota.removeFiles(id); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
