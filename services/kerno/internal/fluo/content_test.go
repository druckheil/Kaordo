package fluo

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateContent(t *testing.T) {
	valid := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello","marks":[{"type":"bold"}]},{"type":"hardBreak"},{"type":"text","text":"world"}]}]}`)
	_, text, err := ValidateContent(valid, 20)
	if err != nil || text != "Hello\nworld" {
		t.Fatalf("text = %q, %v", text, err)
	}
	for _, raw := range []string{
		`{"type":"doc","content":[{"type":"heading"}]}`,
		`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link"}]}]}]}`,
		`{"type":"doc","content":[],"unexpected":true}`,
		`{"type":"doc","content":[]} {"type":"doc"}`,
		`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"too long"}]}]}`,
	} {
		limit := 20
		if strings.Contains(raw, "too long") {
			limit = 2
		}
		if _, _, err := ValidateContent(json.RawMessage(raw), limit); err == nil {
			t.Fatalf("accepted invalid content: %s", raw)
		}
	}
}
