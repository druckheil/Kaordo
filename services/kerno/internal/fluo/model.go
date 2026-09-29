package fluo

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"time"
)

var (
	ErrNotFound        = errors.New("post not found")
	ErrInvalidRelation = errors.New("post cannot reference that item")
	ErrSelfFollow      = errors.New("you cannot follow yourself")
	ErrRateLimited     = errors.New("posting too quickly")
	ErrMediaOwner      = errors.New("media upload belongs to another account")
	uuidPattern        = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

func ValidID(id string) bool { return uuidPattern.MatchString(id) }

type Author struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Following   bool   `json:"following"`
}

type Quote struct {
	ID     string `json:"id"`
	Author Author `json:"author"`
	Text   string `json:"text"`
}

type Media struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	MimeType string `json:"mimeType"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Size     int64  `json:"size"`
	URL      string `json:"url,omitempty"`
}

type Counts struct {
	Good     int64 `json:"good"`
	Bad      int64 `json:"bad"`
	Comments int64 `json:"comments"`
}

type Post struct {
	ID         string          `json:"id"`
	Author     Author          `json:"author"`
	Content    json.RawMessage `json:"content"`
	Text       string          `json:"text"`
	Visibility string          `json:"visibility"`
	ParentID   *string         `json:"parentId"`
	QuoteID    *string         `json:"quoteId"`
	Quote      *Quote          `json:"quote"`
	Media      []Media         `json:"media"`
	Saved      bool            `json:"saved"`
	Counts     Counts          `json:"counts"`
	MyReaction *string         `json:"myReaction"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

type NewPost struct {
	Content       json.RawMessage `json:"content"`
	Visibility    string          `json:"visibility"`
	ParentID      *string         `json:"parentId"`
	QuoteID       *string         `json:"quoteId"`
	AttachmentIDs []string        `json:"attachmentIds"`
}

type Page struct {
	Items      []Post  `json:"items"`
	NextCursor *string `json:"nextCursor"`
}

type ListOptions struct {
	ViewerID string
	Feed     string
	Search   string
	ParentID *string
	Cursor   *Cursor
	Limit    int
}

type Cursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

func EncodeCursor(post Post) string {
	encoded, _ := json.Marshal(Cursor{CreatedAt: post.CreatedAt, ID: post.ID})
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func DecodeCursor(raw string) (*Cursor, error) {
	if raw == "" {
		return nil, nil
	}
	if len(raw) > 256 {
		return nil, errors.New("cursor is too long")
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, errors.New("invalid cursor")
	}
	var cursor Cursor
	if err := json.Unmarshal(data, &cursor); err != nil || !ValidID(cursor.ID) || cursor.CreatedAt.IsZero() {
		return nil, errors.New("invalid cursor")
	}
	return &cursor, nil
}

type Store interface {
	Create(context.Context, string, NewPost, string, []Media) (Post, error)
	Get(context.Context, string, string) (Post, error)
	List(context.Context, ListOptions) (Page, error)
	Delete(context.Context, string, string) ([]string, error)
	SetSaved(context.Context, string, string, bool) error
	MediaReferenced(context.Context, string) (bool, error)
	React(context.Context, string, string, *string) (Post, error)
	Follow(context.Context, string, string, bool) error
}
