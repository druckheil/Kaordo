package encryption

// Validates signed Fluo envelopes whose content key is derived from author audience keys
import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"strconv"
	"strings"
)

const KeyringTextPrefix = "kaordo:fluo:v1:"
const MaxKeyringRefs = 64

// KeyRef names one author audience key; version 0 is the author's never-shared self key
type KeyRef struct {
	OwnerID string `json:"ownerId"`
	Version int    `json:"version"`
}

type KeyringEnvelope struct {
	Version    int      `json:"version"`
	Context    string   `json:"context"`
	SenderID   string   `json:"senderId"`
	Nonce      string   `json:"nonce"`
	Ciphertext string   `json:"ciphertext"`
	Keyring    []KeyRef `json:"keyring"`
	Signature  string   `json:"signature"`
}

func ParseKeyring(raw []byte) (KeyringEnvelope, error) {
	var envelope KeyringEnvelope
	if len(raw) == 0 || len(raw) > MaxEnvelopeBytes {
		return envelope, ErrInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		return envelope, ErrInvalid
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return envelope, ErrInvalid
	}
	return envelope, envelope.Validate()
}

func ParseKeyringText(value string) (KeyringEnvelope, error) {
	if !strings.HasPrefix(value, KeyringTextPrefix) {
		return KeyringEnvelope{}, ErrInvalid
	}
	return ParseKeyring([]byte(strings.TrimPrefix(value, KeyringTextPrefix)))
}

func (e KeyringEnvelope) Validate() error {
	if e.Version != 1 || !ValidID(e.SenderID) || len(e.Context) < 6 || len(e.Context) > 180 || strings.ContainsAny(e.Context, "\n\r") ||
		!ValidBase64(e.Nonce, 24) || !ValidBase64(e.Signature, 64) || len(e.Keyring) == 0 || len(e.Keyring) > MaxKeyringRefs {
		return ErrInvalid
	}
	ciphertext, err := base64.StdEncoding.Strict().DecodeString(e.Ciphertext)
	if err != nil || len(ciphertext) < 16 || len(ciphertext) > MaxEnvelopeBytes {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for index, ref := range e.Keyring {
		// Sorted unique owners make the derived content key independent of request ordering.
		if !ValidID(ref.OwnerID) || ref.Version < 0 || seen[ref.OwnerID] || index > 0 && e.Keyring[index-1].OwnerID >= ref.OwnerID {
			return ErrInvalid
		}
		seen[ref.OwnerID] = true
	}
	if !seen[e.SenderID] {
		return ErrInvalid
	}
	return nil
}

// Ref returns the sender's own audience key reference
func (e KeyringEnvelope) Ref(ownerID string) (KeyRef, bool) {
	for _, ref := range e.Keyring {
		if ref.OwnerID == ownerID {
			return ref, true
		}
	}
	return KeyRef{}, false
}

func (e KeyringEnvelope) Verify(signingPublicKey string) error {
	if err := e.Validate(); err != nil || !ValidBase64(signingPublicKey, 32) {
		return ErrInvalid
	}
	values := []string{"kaordo-keyring-v1", e.Context, e.SenderID, e.Nonce, e.Ciphertext}
	for _, ref := range e.Keyring {
		values = append(values, ref.OwnerID+":"+strconv.Itoa(ref.Version))
	}
	publicKey, _ := base64.StdEncoding.DecodeString(signingPublicKey)
	signature, _ := base64.StdEncoding.DecodeString(e.Signature)
	if !ed25519.Verify(publicKey, []byte(strings.Join(values, "\n")), signature) {
		return ErrInvalid
	}
	return nil
}
