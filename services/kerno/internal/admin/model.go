package admin

// Defines administrative projections and operations without storage dependencies
import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrTarget   = errors.New("admin target is unavailable")
	ErrNotFound = errors.New("admin resource not found")
)

type Summary struct {
	Users         int64        `json:"users"`
	Posts         int64        `json:"posts"`
	Messages      int64        `json:"messages"`
	Uploads       int64        `json:"uploads"`
	MediaBytes    int64        `json:"mediaBytes"`
	DatabaseBytes int64        `json:"databaseBytes"`
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

type Store interface {
	Summary(context.Context) (Summary, error)
	Users(context.Context, string) ([]User, error)
	SetDisabled(context.Context, string, string, bool, string) (User, error)
	SetAdmin(context.Context, string, string, bool, string) (User, error)
	Audit(context.Context) ([]AuditEntry, error)
	Record(context.Context, string, string, string, string, any) error
}
