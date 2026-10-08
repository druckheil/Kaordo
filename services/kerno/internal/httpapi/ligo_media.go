package httpapi

// Validates Ligo attachments and decorates authorized media links
import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/mediaauth"
)

func (h ligoHandler) decorate(message *ligo.Message) error {
	for index := range message.Media {
		url, err := mediaauth.SignedURL(h.deps.MediaBaseURL, message.Media[index].ID,
			time.Now().Add(9*time.Minute), h.deps.MediaSignKey)
		if err != nil {
			return err
		}
		message.Media[index].URL = url
	}
	return nil
}

func (h ligoHandler) validateMessageMedia(w http.ResponseWriter, r *http.Request, input ligo.NewMessage) ([]ligo.Media, bool) {
	seen := make(map[string]struct{}, len(input.AttachmentIDs))
	media := make([]ligo.Media, 0, len(input.AttachmentIDs))
	for _, uploadID := range input.AttachmentIDs {
		item, ok := h.validateMessageAttachment(w, r, uploadID, input.AltTexts[uploadID], seen)
		if !ok {
			return nil, false
		}
		media = append(media, item)
	}
	for uploadID := range input.AltTexts {
		if _, attached := seen[uploadID]; !attached {
			writeError(w, http.StatusBadRequest, "Alt text must belong to an attached file.")
			return nil, false
		}
	}
	return media, true
}

func (h ligoHandler) validateMessageAttachment(w http.ResponseWriter, r *http.Request, uploadID, altText string, seen map[string]struct{}) (ligo.Media, bool) {
	if !ligoID(uploadID) {
		writeError(w, http.StatusBadRequest, "Attachment IDs must be unique UUIDs.")
		return ligo.Media{}, false
	}
	if _, duplicate := seen[uploadID]; duplicate {
		writeError(w, http.StatusBadRequest, "Attachment IDs must be unique UUIDs.")
		return ligo.Media{}, false
	}
	seen[uploadID] = struct{}{}
	altText = strings.TrimSpace(altText)
	if utf8.RuneCountInString(altText) > 500 || strings.ContainsRune(altText, 0) {
		writeError(w, http.StatusBadRequest, "Alt text must be 500 characters or fewer.")
		return ligo.Media{}, false
	}
	if h.deps.Media == nil {
		writeError(w, http.StatusServiceUnavailable, "Media storage is unavailable.")
		return ligo.Media{}, false
	}
	item, err := h.deps.Media.ValidateLigo(r.Context(), r.Header.Get("Authorization"), uploadID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "An attachment is unavailable or not yours.")
		return ligo.Media{}, false
	}
	item.AltText = altText
	return item, true
}
