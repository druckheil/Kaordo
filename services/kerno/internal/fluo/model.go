package fluo

// Defines Fluo models, cursor encoding, and persistence contracts
import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"time"
)

const maxEncodedCursorLength = 256

var (
	ErrNotFound          = errors.New("post not found")
	ErrInvalidRelation   = errors.New("post cannot reference that item")
	ErrInvalidVisibility = errors.New("post visibility must be public or private")
	ErrSelfFollow        = errors.New("you cannot follow yourself")
	ErrRateLimited       = errors.New("posting too quickly")
	ErrMediaOwner        = errors.New("media upload belongs to another account")
)

const (
	VisibilityPublic  = "public"
	VisibilityPrivate = "private"
)

var fluoIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

var (
	errCursorTooLong = errors.New("cursor is too long")
	errInvalidCursor = errors.New("invalid cursor")
)

func ValidID(id string) bool { return fluoIDPattern.MatchString(id) }

func ValidVisibility(value string) bool {
	return value == VisibilityPublic || value == VisibilityPrivate
}

type Author struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Following   bool   `json:"following"`
}

type Quote struct {
	ID     string  `json:"id"`
	Author Author  `json:"author"`
	Text   string  `json:"text"`
	Media  []Media `json:"media"`
}

type Media struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	MimeType string `json:"mimeType"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Size     int64  `json:"size"`
	AltText  string `json:"altText"`
	URL      string `json:"url,omitempty"`
}

type Counts struct {
	Good     int64 `json:"good"`
	Bad      int64 `json:"bad"`
	Comments int64 `json:"comments"`
}

type Post struct {
	ID           string          `json:"id"`
	Author       Author          `json:"author"`
	Content      json.RawMessage `json:"content"`
	Text         string          `json:"text"`
	Visibility   string          `json:"visibility"`
	ParentID     *string         `json:"parentId"`
	QuoteID      *string         `json:"quoteId"`
	QuoteDeleted bool            `json:"quoteDeleted"`
	Quote        *Quote          `json:"quote"`
	Media        []Media         `json:"media"`
	Saved        bool            `json:"saved"`
	Counts       Counts          `json:"counts"`
	MyReaction   *string         `json:"myReaction"`
	CreatedAt    time.Time       `json:"createdAt"`
	UpdatedAt    time.Time       `json:"updatedAt"`
}

type NewPost struct {
	Content       json.RawMessage   `json:"content"`
	Visibility    string            `json:"visibility"`
	ParentID      *string           `json:"parentId"`
	QuoteID       *string           `json:"quoteId"`
	AttachmentIDs []string          `json:"attachmentIds"`
	AltTexts      map[string]string `json:"altTexts"`
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
	encoded, err := json.Marshal(Cursor{CreatedAt: post.CreatedAt, ID: post.ID})
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func DecodeCursor(raw string) (*Cursor, error) {
	if raw == "" {
		return nil, nil
	}
	if len(raw) > maxEncodedCursorLength {
		return nil, errCursorTooLong
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, errInvalidCursor
	}
	return parseCursor(data)
}

func parseCursor(data []byte) (*Cursor, error) {
	var cursor Cursor
	if err := json.Unmarshal(data, &cursor); err != nil {
		return nil, errInvalidCursor
	}
	if !ValidID(cursor.ID) || cursor.CreatedAt.IsZero() {
		return nil, errInvalidCursor
	}
	return &cursor, nil
}

type Store interface {
	Create(context.Context, string, NewPost, string, []Media) (Post, error)
	Get(context.Context, string, string) (Post, error)
	List(context.Context, ListOptions) (Page, error)
	SetVisibility(context.Context, string, string, string) error
	Delete(context.Context, string, string) ([]string, error)
	SetSaved(context.Context, string, string, bool) error
	MediaReferenced(context.Context, string) (bool, error)
	React(context.Context, string, string, *string) (Post, error)
	Follow(context.Context, string, string, bool) error
}
