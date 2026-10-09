// Package ntfy publishes administrator notices to an ntfy topic.
package ntfy

// Posts a notice with its title, priority, tags and a link back to Regado
import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
)

var _ admin.Pusher = Client{}

type Client struct {
	// Token is an optional access token for protected topics; it never appears in errors
	Token string
	// Link opens Regado when the notification is tapped
	Link string
	HTTP *http.Client
}

func (client Client) Push(ctx context.Context, channel admin.NtfyChannel, notice admin.Notice) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	endpoint := strings.TrimRight(channel.URL, "/") + "/" + channel.Topic
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(notice.Message))
	if err != nil {
		return err
	}
	request.Header.Set("Title", notice.Title)
	request.Header.Set("Priority", notice.Priority)
	request.Header.Set("Tags", strings.Join(notice.Tags, ","))
	if client.Link != "" {
		request.Header.Set("Click", client.Link)
	}
	if client.Token != "" {
		request.Header.Set("Authorization", "Bearer "+client.Token)
	}
	httpClient := client.HTTP
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<16))
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("ntfy answered %d", response.StatusCode)
	}
	return nil
}
