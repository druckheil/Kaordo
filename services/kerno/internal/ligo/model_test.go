package ligo

// Covers bounded conversation cursors without database or authorization fixtures
import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestConversationCursorRoundTrip(t *testing.T) {
	item := Conversation{ID: "01999abc-1234-7000-8000-000000000001", UpdatedAt: time.Date(2026, 10, 7, 12, 30, 4, 123456000, time.UTC)}
	encoded := EncodeConversationCursor(item)
	cursor, err := DecodeConversationCursor(encoded)
	if err != nil || cursor == nil || cursor.ID != item.ID || !cursor.UpdatedAt.Equal(item.UpdatedAt) {
		t.Fatalf("cursor round trip: %+v, %v", cursor, err)
	}
	if cursor, err := DecodeConversationCursor(""); err != nil || cursor != nil {
		t.Fatalf("first page cursor: %+v, %v", cursor, err)
	}
	item.UpdatedAt = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
	if value := EncodeConversationCursor(item); value != "" {
		t.Fatalf("encoded an unrepresentable timestamp: %q", value)
	}
}

func TestConversationCursorRejectsInvalidInput(t *testing.T) {
	const validID = "01999abc-1234-7000-8000-000000000001"
	for name, document := range map[string]string{
		"malformed":      "{",
		"missing fields": "{}",
		"invalid ID":     `{"ID":"not-an-id","UpdatedAt":"2026-10-07T12:00:00Z"}`,
		"missing time":   `{"ID":"` + validID + `"}`,
		"zero time":      `{"ID":"` + validID + `","UpdatedAt":"0001-01-01T00:00:00Z"}`,
		"invalid time":   `{"ID":"` + validID + `","UpdatedAt":"invalid"}`,
		"wrong type":     `{"ID":42,"UpdatedAt":"2026-10-07T12:00:00Z"}`,
		"trailing JSON":  `{"ID":"` + validID + `","UpdatedAt":"2026-10-07T12:00:00Z"}{}`,
	} {
		t.Run(name, func(t *testing.T) {
			encoded := base64.RawURLEncoding.EncodeToString([]byte(document))
			if cursor, err := DecodeConversationCursor(encoded); cursor != nil || !errors.Is(err, errInvalidConversationCursor) {
				t.Fatalf("accepted invalid cursor: %+v, %v", cursor, err)
			}
		})
	}
	for _, input := range []string{"%%%", strings.Repeat("a", maxEncodedConversationCursorLength+1)} {
		if cursor, err := DecodeConversationCursor(input); cursor != nil || !errors.Is(err, errInvalidConversationCursor) {
			t.Fatalf("accepted malformed or oversized cursor: %+v, %v", cursor, err)
		}
	}
}
