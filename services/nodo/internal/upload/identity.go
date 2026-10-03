package upload

// Resolves Kaordo account identity and validates ownership of uploads
import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	tusd "github.com/tus/tusd/v2/pkg/handler"
)

func validUploadID(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed.Version() == 7 && parsed.String() == id
}

func (server *Server) identity(ctx context.Context, bearer string) (string, int) {
	if !strings.HasPrefix(bearer, "Bearer ") {
		return "", http.StatusUnauthorized
	}
	if server.config.VerifyOwner != nil {
		return server.verifiedIdentity(ctx, bearer)
	}
	return server.kernoIdentity(ctx, bearer)
}

func (server *Server) verifiedIdentity(ctx context.Context, bearer string) (string, int) {
	id, err := server.config.VerifyOwner(ctx, bearer)
	if err != nil || id == "" {
		return "", http.StatusUnauthorized
	}
	return id, http.StatusOK
}

func (server *Server) kernoIdentity(ctx context.Context, bearer string) (string, int) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet,
		strings.TrimRight(server.config.KernoURL, "/")+"/v1/me", nil)
	if err != nil {
		return "", http.StatusServiceUnavailable
	}
	request.Header.Set("Authorization", bearer)

	response, err := server.identityClient().Do(request)
	if err != nil {
		return "", http.StatusServiceUnavailable
	}
	defer response.Body.Close()

	if response.StatusCode == http.StatusUnauthorized {
		return "", http.StatusUnauthorized
	}
	if response.StatusCode == http.StatusForbidden {
		return "", http.StatusForbidden
	}
	if response.StatusCode != http.StatusOK {
		return "", http.StatusServiceUnavailable
	}

	return decodeKernoIdentity(response.Body)
}

func (server *Server) identityClient() *http.Client {
	if server.config.Client != nil {
		return server.config.Client
	}
	return &http.Client{Timeout: 5 * time.Second}
}

func decodeKernoIdentity(body io.Reader) (string, int) {
	var user struct{ ID string }
	if err := json.NewDecoder(io.LimitReader(body, 4096)).Decode(&user); err != nil || user.ID == "" {
		return "", http.StatusServiceUnavailable
	}
	return user.ID, http.StatusOK
}

func (server *Server) ownerOf(ctx context.Context, id string) (tusd.FileInfo, error) {
	if !validUploadID(id) {
		return tusd.FileInfo{}, tusd.ErrNotFound
	}
	upload, err := server.store.GetUpload(ctx, id)
	if err != nil {
		return tusd.FileInfo{}, err
	}
	return upload.GetInfo(ctx)
}
