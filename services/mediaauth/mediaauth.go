package mediaauth

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

func ParseKey(encoded string) ([]byte, error) {
	key, err := hex.DecodeString(encoded)
	if err != nil || len(key) != 32 {
		return nil, errors.New("NODO_MEDIA_SIGNING_KEY must contain 32 random bytes as hex")
	}
	return key, nil
}

func signature(id string, expiry int64, key []byte) string {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(strconv.FormatInt(expiry, 10)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func InternalToken(key []byte) string {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("kaordo-nodo-internal-v1"))
	return hex.EncodeToString(mac.Sum(nil))
}

func VerifyInternalToken(provided string, key []byte) bool {
	actual, err := hex.DecodeString(provided)
	if err != nil {
		return false
	}
	expected, err := hex.DecodeString(InternalToken(key))
	return err == nil && hmac.Equal(actual, expected)
}

func SignedURL(baseURL, id string, expiry time.Time, key []byte) (string, error) {
	base, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || base.Scheme == "" || base.Host == "" || base.User != nil || base.RawQuery != "" {
		return "", errors.New("invalid Nodo public URL")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/v1/media/" + id
	query := base.Query()
	query.Set("exp", strconv.FormatInt(expiry.Unix(), 10))
	query.Set("sig", signature(id, expiry.Unix(), key))
	base.RawQuery = query.Encode()
	return base.String(), nil
}

func Verify(id, expiryRaw, provided string, key []byte, now time.Time) bool {
	expiry, err := strconv.ParseInt(expiryRaw, 10, 64)
	if err != nil || expiry <= now.Unix() || expiry > now.Add(10*time.Minute).Unix() {
		return false
	}
	expected, err := base64.RawURLEncoding.DecodeString(signature(id, expiry, key))
	if err != nil {
		return false
	}
	actual, err := base64.RawURLEncoding.DecodeString(provided)
	return err == nil && hmac.Equal(actual, expected)
}
