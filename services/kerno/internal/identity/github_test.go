package identity

// Verifies which GitHub Actions tokens may request a production deployment
import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-jose/go-jose/v4"
)

func TestGitHubVerifierAcceptsOnlyPushRunsOfTheTrustedWorkflow(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		t.Fatal(err)
	}
	const workflow = "owner/app/.github/workflows/checks.yml@refs/heads/main"
	valid := map[string]any{
		"iss": githubIssuer, "aud": "https://example.test", "sub": "repo:owner/app:environment:production",
		"exp": time.Now().Add(5 * time.Minute).Unix(), "iat": time.Now().Unix(),
		"workflow_ref": workflow, "event_name": "push", "run_id": "1234", "run_attempt": "2", "sha": strings.Repeat("a", 40),
	}
	token := func(changes map[string]any) string {
		t.Helper()
		claims := map[string]any{}
		for name, value := range valid {
			claims[name] = value
		}
		for name, value := range changes {
			claims[name] = value
		}
		payload, err := json.Marshal(claims)
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
	verify := newGitHubVerifier(githubIssuer, &oidc.StaticKeySet{PublicKeys: []crypto.PublicKey{&key.PublicKey}}, "https://example.test", workflow)

	run, err := verify(context.Background(), token(nil))
	if err != nil || run.ID != 1234 || run.Attempt != 2 || run.Revision != strings.Repeat("a", 40) {
		t.Fatalf("trusted run = %+v, %v", run, err)
	}
	for name, changes := range map[string]map[string]any{
		"pull request":       {"event_name": "pull_request", "workflow_ref": "owner/app/.github/workflows/checks.yml@refs/pull/7/merge"},
		"other branch":       {"workflow_ref": "owner/app/.github/workflows/checks.yml@refs/heads/feature"},
		"other workflow":     {"workflow_ref": "owner/app/.github/workflows/release.yml@refs/heads/main"},
		"fork":               {"workflow_ref": "fork/app/.github/workflows/checks.yml@refs/heads/main"},
		"manual dispatch":    {"event_name": "workflow_dispatch"},
		"other audience":     {"aud": "https://elsewhere.test"},
		"other issuer":       {"iss": "https://issuer.test"},
		"expired":            {"exp": time.Now().Add(-time.Minute).Unix()},
		"malformed run":      {"run_id": "latest"},
		"malformed attempt":  {"run_attempt": "0"},
		"missing attempt":    {"run_attempt": ""},
		"malformed revision": {"sha": "abc"},
	} {
		if _, err := verify(context.Background(), token(changes)); err == nil {
			t.Errorf("%s was trusted", name)
		}
	}
}
