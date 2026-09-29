package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/mediaauth"
)

type NodoClient struct {
	BaseURL     string
	Client      *http.Client
	InternalKey []byte
}

func (client NodoClient) Purge(ctx context.Context, id string) error {
	if !fluo.ValidID(id) || len(client.InternalKey) != 32 {
		return errors.New("invalid media cleanup request")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		strings.TrimRight(client.BaseURL, "/")+"/v1/media/"+id, nil)
	if err != nil {
		return err
	}
	request.Header.Set("X-Kaordo-Internal-Token", mediaauth.InternalToken(client.InternalKey))
	httpClient := client.Client
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 2 * time.Second}
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("Nodo cleanup returned status %d", response.StatusCode)
	}
	return nil
}

func (client NodoClient) Validate(ctx context.Context, bearer, id string) (fluo.Media, error) {
	if !fluo.ValidID(id) || bearer == "" {
		return fluo.Media{}, errors.New("invalid upload reference")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet,
		strings.TrimRight(client.BaseURL, "/")+"/v1/uploads/"+id+"/meta", nil)
	if err != nil {
		return fluo.Media{}, err
	}
	request.Header.Set("Authorization", bearer)
	httpClient := client.Client
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return fluo.Media{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fluo.Media{}, fmt.Errorf("Nodo rejected upload metadata with status %d", response.StatusCode)
	}
	var result struct {
		fluo.Media
		Complete bool `json:"complete"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&result); err != nil {
		return fluo.Media{}, err
	}
	item := result.Media
	if !result.Complete || item.ID != id || item.Size <= 0 || item.Size > 104857600 ||
		item.Width < 1 || item.Width > 8192 || item.Height < 1 || item.Height > 8192 ||
		(item.Kind != "image" && item.Kind != "video") {
		return fluo.Media{}, errors.New("upload is incomplete or invalid")
	}
	return item, nil
}
