package identity

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-jose/go-jose/v4"
)

func TestVerifyAccessTokenClaims(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	var issuer string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/.well-known/openid-configuration") {
			_ = json.NewEncoder(w).Encode(map[string]string{
				"issuer": issuer, "jwks_uri": issuer + "/keys",
				"authorization_endpoint": issuer + "/auth", "token_endpoint": issuer + "/token",
			})
			return
		}
		if strings.HasSuffix(r.URL.Path, "/keys") {
			_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{
				Key: &key.PublicKey, KeyID: "test", Algorithm: "RS256", Use: "sig",
			}}})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	issuer = server.URL + "/realms/kaordo"
	provider, err := NewProvider(context.Background(), issuer)
	if err != nil {
		t.Fatal(err)
	}
	verifier := provider.Verifier(&oidc.Config{ClientID: "kerno-api"})

	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "test"))
	if err != nil {
		t.Fatal(err)
	}
	token := func(audience string, expiry time.Time, username string) string {
		t.Helper()
		payload, err := json.Marshal(map[string]any{
			"iss": issuer, "sub": "subject-1", "aud": audience,
			"exp": expiry.Unix(), "iat": time.Now().Add(-time.Minute).Unix(),
			"preferred_username": username, "name": "Alice",
		})
		if err != nil {
			t.Fatal(err)
		}
		signed, err := signer.Sign(payload)
		if err != nil {
			t.Fatal(err)
		}
		compact, err := signed.CompactSerialize()
		if err != nil {
			t.Fatal(err)
		}
		return compact
	}

	claims, err := Verify(context.Background(), verifier, token("kerno-api", time.Now().Add(time.Hour), "alice"))
	if err != nil || claims.Subject != "subject-1" || claims.Username != "alice" {
		t.Fatalf("valid access token rejected: claims=%+v error=%v", claims, err)
	}
	for _, candidate := range []string{
		token("kaordo-web", time.Now().Add(time.Hour), "alice"),
		token("kerno-api", time.Now().Add(-time.Hour), "alice"),
		token("kerno-api", time.Now().Add(time.Hour), ""),
	} {
		if _, err := Verify(context.Background(), verifier, candidate); err == nil {
			t.Fatal("invalid access token accepted")
		}
	}
}

func TestFailureCodeDoesNotRevealVerifierClaims(t *testing.T) {
	for _, test := range []struct {
		err  error
		want string
	}{
		{&oidc.TokenExpiredError{}, "expired_token"},
		{ErrMissingSubject, "missing_subject"},
		{ErrMissingUsername, "missing_username"},
		{errors.New(`oidc: expected audience "kerno-api" got ["secret-client"]`), "invalid_audience"},
		{errors.New(`oidc: id token issued by a different provider, expected "safe" got "private"`), "invalid_issuer"},
		{errors.New("failed to verify signature: private certificate path"), "invalid_token"},
	} {
		if got := FailureCode(test.err); got != test.want {
			t.Errorf("FailureCode(%v) = %q; want %q", test.err, got, test.want)
		}
	}
}
