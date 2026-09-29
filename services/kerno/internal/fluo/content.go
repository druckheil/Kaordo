package fluo

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"unicode/utf8"
)

type mark struct {
	Type string `json:"type"`
}

type node struct {
	Type    string `json:"type"`
	Text    string `json:"text,omitempty"`
	Marks   []mark `json:"marks,omitempty"`
	Content []node `json:"content,omitempty"`
}

func ValidateContent(raw json.RawMessage, maxRunes int) (json.RawMessage, string, error) {
	if len(raw) == 0 || len(raw) > 32*1024 {
		return nil, "", errors.New("content must be a Tiptap document under 32 KiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var doc node
	if err := decoder.Decode(&doc); err != nil || doc.Type != "doc" || doc.Text != "" || len(doc.Marks) != 0 || len(doc.Content) > 100 {
		return nil, "", errors.New("content has an unsupported document structure")
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return nil, "", errors.New("content must contain one document")
	}
	paragraphs := make([]string, 0, len(doc.Content))
	for _, block := range doc.Content {
		if block.Type != "paragraph" || block.Text != "" || len(block.Marks) != 0 || len(block.Content) > 1000 {
			return nil, "", errors.New("content supports paragraphs only")
		}
		var line strings.Builder
		for _, inline := range block.Content {
			switch inline.Type {
			case "text":
				if inline.Text == "" || len(inline.Content) != 0 || !utf8.ValidString(inline.Text) {
					return nil, "", errors.New("content has invalid text")
				}
				for _, mark := range inline.Marks {
					if mark.Type != "bold" && mark.Type != "italic" && mark.Type != "strike" {
						return nil, "", errors.New("content has an unsupported mark")
					}
				}
				line.WriteString(inline.Text)
			case "hardBreak":
				if inline.Text != "" || len(inline.Marks) != 0 || len(inline.Content) != 0 {
					return nil, "", errors.New("content has an invalid line break")
				}
				line.WriteByte('\n')
			default:
				return nil, "", errors.New("content has an unsupported node")
			}
		}
		paragraphs = append(paragraphs, line.String())
	}
	text := strings.TrimSpace(strings.Join(paragraphs, "\n"))
	if utf8.RuneCountInString(text) > maxRunes {
		return nil, "", errors.New("content is too long")
	}
	canonical, err := json.Marshal(doc)
	return canonical, text, err
}
