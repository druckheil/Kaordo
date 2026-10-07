package mediaauth

// Signs media URLs and validates internal Nodo requests
import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	keySize             = 32
	internalTokenDomain = "kaordo-nodo-internal-v1"
	maximumSignatureAge = 10 * time.Minute
)

func ParseKey(encoded string) ([]byte, error) {
	key, err := hex.DecodeString(encoded)
	if err != nil || len(key) != keySize {
		return nil, errors.New("NODO_MEDIA_SIGNING_KEY must contain 32 random bytes as hex")
	}
	return key, nil
}

func signature(id string, expiry int64, key []byte) string {
	return base64.RawURLEncoding.EncodeToString(signatureBytes(id, expiry, key))
}

func hmacSHA256(key, payload []byte) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(payload)
	return mac.Sum(nil)
}

func InternalToken(key []byte) string {
	return hex.EncodeToString(internalTokenSignature(key))
}

func internalTokenSignature(key []byte) []byte {
	return hmacSHA256(key, []byte(internalTokenDomain))
}

func VerifyInternalToken(provided string, key []byte) bool {
	actual, err := hex.DecodeString(provided)
	return err == nil && hmac.Equal(actual, internalTokenSignature(key))
}

func SignedURL(baseURL, id string, expiry time.Time, key []byte) (string, error) {
	base, err := parsePublicBaseURL(baseURL)
	if err != nil {
		return "", err
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/v1/media/" + id
	query := base.Query()
	query.Set("exp", strconv.FormatInt(expiry.Unix(), 10))
	query.Set("sig", signature(id, expiry.Unix(), key))
	base.RawQuery = query.Encode()
	return base.String(), nil
}

func parsePublicBaseURL(raw string) (*url.URL, error) {
	base, err := url.Parse(strings.TrimRight(raw, "/"))
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return nil, errors.New("invalid Nodo public URL")
	}
	return base, nil
}

func Verify(id, expiryRaw, provided string, key []byte, now time.Time) bool {
	expiry, valid := validExpiry(expiryRaw, now)
	if !valid {
		return false
	}
	actual, err := base64.RawURLEncoding.DecodeString(provided)
	return err == nil && hmac.Equal(actual, signatureBytes(id, expiry, key))
}

func validExpiry(raw string, now time.Time) (int64, bool) {
	expiry, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || expiry <= now.Unix() || expiry > now.Add(maximumSignatureAge).Unix() {
		return 0, false
	}
	return expiry, true
}

func signatureBytes(id string, expiry int64, key []byte) []byte {
	payload := id + "\n" + strconv.FormatInt(expiry, 10)
	return hmacSHA256(key, []byte(payload))
}
