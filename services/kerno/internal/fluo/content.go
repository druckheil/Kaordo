package fluo

// Validates and canonicalizes the Tiptap document format accepted by Fluo
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

const (
	maxContentBytes     = 32 * 1024
	maxDocumentBlocks   = 100
	maxParagraphContent = 1000
)

func ValidateContent(raw json.RawMessage, maxRunes int) (json.RawMessage, string, error) {
	if len(raw) == 0 || len(raw) > maxContentBytes {
		return nil, "", errors.New("content must be a Tiptap document under 32 KiB")
	}
	doc, err := decodeDocument(raw)
	if err != nil {
		return nil, "", err
	}
	text, err := documentText(doc, maxRunes)
	if err != nil {
		return nil, "", err
	}
	canonical, err := json.Marshal(doc)
	return canonical, text, err
}

func decodeDocument(raw json.RawMessage) (node, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var doc node
	if err := decoder.Decode(&doc); err != nil {
		return node{}, errors.New("content has an unsupported document structure")
	}
	if !validDocumentRoot(doc) {
		return node{}, errors.New("content has an unsupported document structure")
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return node{}, errors.New("content must contain one document")
	}
	return doc, nil
}

func validDocumentRoot(doc node) bool {
	return doc.Type == "doc" && doc.Text == "" && len(doc.Marks) == 0 && len(doc.Content) <= maxDocumentBlocks
}

func documentText(doc node, maxRunes int) (string, error) {
	paragraphs := make([]string, 0, len(doc.Content))
	for _, block := range doc.Content {
		paragraph, err := paragraphText(block)
		if err != nil {
			return "", err
		}
		paragraphs = append(paragraphs, paragraph)
	}
	text := strings.TrimSpace(strings.Join(paragraphs, "\n"))
	if utf8.RuneCountInString(text) > maxRunes {
		return "", errors.New("content is too long")
	}
	return text, nil
}

func paragraphText(block node) (string, error) {
	if block.Type != "paragraph" || block.Text != "" || len(block.Marks) != 0 || len(block.Content) > maxParagraphContent {
		return "", errors.New("content supports paragraphs only")
	}
	var line strings.Builder
	for _, inline := range block.Content {
		text, err := inlineText(inline)
		if err != nil {
			return "", err
		}
		line.WriteString(text)
	}
	return line.String(), nil
}

func inlineText(inline node) (string, error) {
	switch inline.Type {
	case "text":
		return textNodeValue(inline)
	case "hardBreak":
		if inline.Text != "" || len(inline.Marks) != 0 || len(inline.Content) != 0 {
			return "", errors.New("content has an invalid line break")
		}
		return "\n", nil
	default:
		return "", errors.New("content has an unsupported node")
	}
}

func textNodeValue(inline node) (string, error) {
	if inline.Text == "" || len(inline.Content) != 0 || !utf8.ValidString(inline.Text) {
		return "", errors.New("content has invalid text")
	}
	for _, mark := range inline.Marks {
		if !validMark(mark) {
			return "", errors.New("content has an unsupported mark")
		}
	}
	return inline.Text, nil
}

func validMark(value mark) bool {
	switch value.Type {
	case "bold", "italic", "strike":
		return true
	default:
		return false
	}
}
