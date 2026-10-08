package nodoclient

// Calls Nodo to validate uploads and purge retired media
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
	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/mediaauth"
)

type Client struct {
	BaseURL     string
	Client      *http.Client
	InternalKey []byte
}

const maxUploadSize = 100 * 1024 * 1024

func (client Client) Purge(ctx context.Context, id string) error {
	if !fluo.ValidID(id) || len(client.InternalKey) != 32 {
		return errors.New("invalid media cleanup request")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		strings.TrimRight(client.BaseURL, "/")+"/v1/media/"+id, nil)
	if err != nil {
		return err
	}
	request.Header.Set("X-Kaordo-Internal-Token", mediaauth.InternalToken(client.InternalKey))
	response, err := client.httpClient(2 * time.Second).Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("Nodo cleanup returned status %d", response.StatusCode)
	}
	return nil
}

func (client Client) ValidateLigo(ctx context.Context, bearer, id string) (ligo.Media, error) {
	if !fluo.ValidID(id) || bearer == "" {
		return ligo.Media{}, errors.New("invalid upload reference")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet,
		strings.TrimRight(client.BaseURL, "/")+"/v1/uploads/"+id+"/meta", nil)
	if err != nil {
		return ligo.Media{}, err
	}
	request.Header.Set("Authorization", bearer)
	response, err := client.httpClient(5 * time.Second).Do(request)
	if err != nil {
		return ligo.Media{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return ligo.Media{}, fmt.Errorf("Nodo rejected upload metadata with status %d", response.StatusCode)
	}
	var result struct {
		ligo.Media
		Complete bool `json:"complete"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&result); err != nil {
		return ligo.Media{}, err
	}
	item := result.Media
	if !validUploadMetadata(id, item, result.Complete) {
		return ligo.Media{}, errors.New("upload is incomplete or invalid")
	}
	return item, nil
}

func (client Client) httpClient(timeout time.Duration) *http.Client {
	if client.Client != nil {
		return client.Client
	}
	return &http.Client{Timeout: timeout}
}

func validUploadMetadata(id string, item ligo.Media, complete bool) bool {
	if !complete || item.ID != id || item.Size <= 0 || item.Size > maxUploadSize {
		return false
	}
	switch item.Kind {
	case "file":
		return item.Width == 0 && item.Height == 0 && item.Filename != "" && item.MimeType == "application/octet-stream"
	case "image", "video":
		return validMediaDimensions(item.Width, item.Height)
	default:
		return false
	}
}

func validMediaDimensions(width, height int) bool {
	return width >= 1 && width <= 8192 && height >= 1 && height <= 8192
}

func (client Client) Validate(ctx context.Context, bearer, id string) (fluo.Media, error) {
	item, err := client.ValidateLigo(ctx, bearer, id)
	if err != nil {
		return fluo.Media{}, err
	}
	// Post attachments are opaque encrypted files; profile images remain public photos.
	if item.Kind != "image" && item.Kind != "video" && item.Kind != "file" {
		return fluo.Media{}, errors.New("Fluo requires a photo, video or encrypted file")
	}
	return fluo.Media{ID: item.ID, Kind: item.Kind, MimeType: item.MimeType,
		Width: item.Width, Height: item.Height, Size: item.Size}, nil
}
