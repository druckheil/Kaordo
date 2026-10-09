package nodoclient

// Requests authenticated Nodo media audits and cleanup of expired unreferenced uploads
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/mediaauth"
)

func (client Client) MediaStatus(ctx context.Context) (json.RawMessage, error) {
	response, err := client.storageRequest(ctx, http.MethodGet, "")
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("storage status request to Nodo returned %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 16384))
	if err != nil {
		return nil, err
	}
	if !json.Valid(data) {
		return nil, errors.New("invalid Nodo storage response")
	}
	return data, nil
}

func (client Client) StartMediaMaintenance(ctx context.Context, clean bool) error {
	operation := "check"
	if clean {
		operation = "repair"
	}
	response, err := client.storageRequest(ctx, http.MethodPost, "/"+operation)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		return fmt.Errorf("storage operation in Nodo returned %d", response.StatusCode)
	}
	return nil
}

func (client Client) storageRequest(ctx context.Context, method, suffix string) (*http.Response, error) {
	if len(client.InternalKey) != 32 {
		return nil, errors.New("internal storage access is unavailable")
	}
	request, err := http.NewRequestWithContext(ctx, method,
		strings.TrimRight(client.BaseURL, "/")+"/v1/internal/storage/maintenance"+suffix, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("X-Kaordo-Internal-Token", mediaauth.InternalToken(client.InternalKey))
	return client.httpClient(5 * time.Second).Do(request)
}
