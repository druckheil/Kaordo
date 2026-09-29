package mediaauth

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
