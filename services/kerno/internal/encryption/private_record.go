package encryption

// Validates opaque indexes and AES-GCM record envelopes without interpreting their plaintext
import (
	"encoding/base64"
	"regexp"
)

var indexPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

func ValidIndex(value string) bool { return indexPattern.MatchString(value) }

type PrivateEnvelope struct {
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

func (e PrivateEnvelope) Validate(maxLength int) error {
	if !ValidBase64(e.Nonce, 12) || len(e.Ciphertext) > maxLength {
		return ErrInvalid
	}
	bytes, err := base64.StdEncoding.Strict().DecodeString(e.Ciphertext)
	if err != nil || len(bytes) < 16 {
		return ErrInvalid
	}
	return nil
}
