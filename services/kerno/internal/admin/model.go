package admin

// Defines administrative projections and operations without storage dependencies
import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrTarget      = errors.New("admin target is unavailable")
	ErrNotFound    = errors.New("admin resource not found")
	ErrAccessLimit = errors.New("too many recent access cases")
)

type Summary struct {
	Users         int64        `json:"users"`
	Posts         int64        `json:"posts"`
	Messages      int64        `json:"messages"`
	Uploads       int64        `json:"uploads"`
	MediaBytes    int64        `json:"mediaBytes"`
	DatabaseBytes int64        `json:"databaseBytes"`
	OpenCases     int64        `json:"openCases"`
	MediaByKind   []MediaUsage `json:"mediaByKind"`
}

type MediaUsage struct {
	Kind    string `json:"kind"`
	Objects int64  `json:"objects"`
	Bytes   int64  `json:"bytes"`
}

type User struct {
	ID           string     `json:"id"`
	Username     string     `json:"username"`
	DisplayName  string     `json:"displayName"`
	IsAdmin      bool       `json:"isAdmin"`
	DisabledAt   *time.Time `json:"disabledAt"`
	PostCount    int64      `json:"postCount"`
	MessageCount int64      `json:"messageCount"`
	MediaBytes   int64      `json:"mediaBytes"`
	LastActivity *time.Time `json:"lastActivity"`
	CreatedAt    time.Time  `json:"createdAt"`
}

type AuditEntry struct {
	ID        string          `json:"id"`
	Actor     string          `json:"actor"`
	Target    *string         `json:"target"`
	Action    string          `json:"action"`
	Reason    string          `json:"reason"`
	Detail    json.RawMessage `json:"detail"`
	CreatedAt time.Time       `json:"createdAt"`
}

type AccessCase struct {
	ID             string    `json:"id"`
	TargetUserID   string    `json:"targetUserId"`
	TargetUsername string    `json:"targetUsername"`
	Reason         string    `json:"reason"`
	CreatedAt      time.Time `json:"createdAt"`
	ExpiresAt      time.Time `json:"expiresAt"`
}

type ContentMedia struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	MimeType string `json:"mimeType"`
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
	URL      string `json:"url"`
}

type Content struct {
	ID        string         `json:"id"`
	Text      string         `json:"text"`
	Context   string         `json:"context"`
	CreatedAt time.Time      `json:"createdAt"`
	Media     []ContentMedia `json:"media"`
}

type ContentPage struct {
	Items      []Content `json:"items"`
	NextCursor *string   `json:"nextCursor"`
}

type Store interface {
	Summary(context.Context) (Summary, error)
	Users(context.Context, string) ([]User, error)
	SetDisabled(context.Context, string, string, bool, string) (User, error)
	SetAdmin(context.Context, string, string, bool, string) (User, error)
	Audit(context.Context) ([]AuditEntry, error)
	Record(context.Context, string, string, string, string, any) error
	CreateAccessCase(context.Context, string, string, string) (AccessCase, error)
	AccessCase(context.Context, string, string) (AccessCase, error)
	CloseCase(context.Context, string, string) error
	CaseContent(context.Context, string, string, string) (ContentPage, error)
}
