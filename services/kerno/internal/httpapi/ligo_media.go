package httpapi

// Validates Ligo attachments and decorates authorized media links
import (
	"net/http"
	"time"

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
	inputs := attachmentInputs{altTexts: input.AltTexts, seen: make(map[string]struct{}, len(input.AttachmentIDs))}
	media := make([]ligo.Media, 0, len(input.AttachmentIDs))
	for _, uploadID := range input.AttachmentIDs {
		item, ok := h.validateMessageAttachment(w, r, uploadID, inputs)
		if !ok {
			return nil, false
		}
		media = append(media, item)
	}
	if err := inputs.validateReferences(); err != nil {
		writeInvalid(w, err)
		return nil, false
	}
	return media, true
}

func (h ligoHandler) validateMessageAttachment(w http.ResponseWriter, r *http.Request, uploadID string, inputs attachmentInputs) (ligo.Media, bool) {
	altText, err := inputs.normalize(uploadID)
	if err != nil {
		writeInvalid(w, err)
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
	if item.MimeType != "application/octet-stream" || item.Kind != "file" {
		writeError(w, http.StatusBadRequest, "Attachments must be encrypted on your device.")
		return ligo.Media{}, false
	}
	return item, true
}
