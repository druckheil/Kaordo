package mediaauth

// Verifies bounded media signatures, internal authentication and public URL configuration
import (
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestSignedURL(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	id := "01999111-2222-7333-8444-555555555555"
	now := time.Now()
	link, err := SignedURL("http://localhost:8082", id, now.Add(9*time.Minute), key)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(link)
	if err != nil {
		t.Fatal(err)
	}
	if !Verify(id, parsed.Query().Get("exp"), parsed.Query().Get("sig"), key, now) {
		t.Fatal("valid media URL was rejected")
	}
	if Verify(id+"x", parsed.Query().Get("exp"), parsed.Query().Get("sig"), key, now) ||
		Verify(id, parsed.Query().Get("exp"), parsed.Query().Get("sig"), key, now.Add(11*time.Minute)) {
		t.Fatal("tampered or expired media URL was accepted")
	}
}

func TestInternalToken(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	token := InternalToken(key)
	if !VerifyInternalToken(token, key) || VerifyInternalToken(token, []byte(strings.Repeat("x", 32))) {
		t.Fatal("internal service token verification failed")
	}
}

func TestPublicURLRejectsNonHTTPAndHiddenComponents(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	for _, base := range []string{"ftp://nodo.example", "javascript://nodo.example", "https://user:password@nodo.example", "https://nodo.example?secret=value", "https://nodo.example#fragment", "https:///missing-host", "not-a-url"} {
		if _, err := SignedURL(base, "media-id", time.Now().Add(time.Minute), key); err == nil {
			t.Fatalf("accepted invalid public URL %q", base)
		}
	}
	for _, base := range []string{"https://nodo.example", "http://localhost:8082", "https://nodo.example/prefix/"} {
		if _, err := SignedURL(base, "media-id", time.Now().Add(time.Minute), key); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSigningKeyAndSignatureBounds(t *testing.T) {
	key, err := ParseKey(strings.Repeat("ab", 32))
	if err != nil || len(key) != 32 {
		t.Fatal("valid key rejected")
	}
	for _, encoded := range []string{"", strings.Repeat("ab", 31), strings.Repeat("ab", 33), strings.Repeat("zz", 32)} {
		if _, err := ParseKey(encoded); err == nil {
			t.Fatal("invalid key accepted")
		}
	}
	now := time.Now()
	for _, expiry := range []time.Time{now, now.Add(-time.Second), now.Add(10*time.Minute + time.Second)} {
		link, err := SignedURL("https://nodo.example", "media-id", expiry, key)
		if err != nil {
			t.Fatal(err)
		}
		parsed, _ := url.Parse(link)
		if Verify("media-id", parsed.Query().Get("exp"), parsed.Query().Get("sig"), key, now) {
			t.Fatal("unbounded expiry accepted")
		}
	}
	if VerifyInternalToken("not-hex", key) || VerifyInternalToken(strings.Repeat("0", 64), key) {
		t.Fatal("invalid service token accepted")
	}
}
