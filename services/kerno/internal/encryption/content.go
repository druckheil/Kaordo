package encryption

// Validates signed content envelopes while never opening their ciphertext or recipient keys
import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"sort"
	"strings"
)

const TextPrefix = "kaordo:e2ee:v1:"
const MaxEnvelopeBytes = 524288

type RecipientKey struct {
	UserID string `json:"userId"`
	Key    string `json:"key"`
}
type ContentEnvelope struct {
	Version    int            `json:"version"`
	Context    string         `json:"context"`
	SenderID   string         `json:"senderId"`
	Nonce      string         `json:"nonce"`
	Ciphertext string         `json:"ciphertext"`
	Keys       []RecipientKey `json:"keys"`
	PublicKey  string         `json:"publicKey"`
	Signature  string         `json:"signature"`
}

func ParseContent(raw []byte) (ContentEnvelope, error) {
	var envelope ContentEnvelope
	if len(raw) > MaxEnvelopeBytes || len(raw) == 0 {
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
func ParseText(value string) (ContentEnvelope, error) {
	if !strings.HasPrefix(value, TextPrefix) {
		return ContentEnvelope{}, ErrInvalid
	}
	return ParseContent([]byte(strings.TrimPrefix(value, TextPrefix)))
}
func (e ContentEnvelope) Validate() error {
	if e.Version != 1 || !ValidID(e.SenderID) || len(e.Context) < 6 || len(e.Context) > 180 || strings.ContainsAny(e.Context, "\n\r") ||
		!ValidBase64(e.Nonce, 24) || !ValidBase64(e.Signature, 64) || len(e.Keys) == 0 || len(e.Keys) > 512 ||
		(e.PublicKey != "" && !ValidBase64(e.PublicKey, 32)) {
		return ErrInvalid
	}
	ciphertext, err := base64.StdEncoding.Strict().DecodeString(e.Ciphertext)
	if err != nil || len(ciphertext) < 16 || len(ciphertext) > MaxEnvelopeBytes {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for _, key := range e.Keys {
		if !ValidID(key.UserID) || !ValidBase64(key.Key, 80) || seen[key.UserID] {
			return ErrInvalid
		}
		seen[key.UserID] = true
	}
	if !seen[e.SenderID] {
		return ErrInvalid
	}
	return nil
}
func (e ContentEnvelope) Verify(senderID, signingPublicKey string) error {
	if err := e.Validate(); err != nil {
		return err
	}
	if e.SenderID != senderID || !ValidBase64(signingPublicKey, 32) {
		return ErrInvalid
	}
	keys := append([]RecipientKey(nil), e.Keys...)
	sort.Slice(keys, func(i, j int) bool { return keys[i].UserID < keys[j].UserID })
	values := []string{"kaordo-content-v1", e.Context, e.SenderID, e.Nonce, e.Ciphertext, e.PublicKey}
	for _, key := range keys {
		values = append(values, key.UserID+":"+key.Key)
	}
	publicKey, _ := base64.StdEncoding.DecodeString(signingPublicKey)
	signature, _ := base64.StdEncoding.DecodeString(e.Signature)
	if !ed25519.Verify(publicKey, []byte(strings.Join(values, "\n")), signature) {
		return ErrInvalid
	}
	return nil
}
