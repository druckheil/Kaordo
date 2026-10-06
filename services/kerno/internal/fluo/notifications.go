package fluo

// Defines recipient-owned Fluo activity, pagination, and read-state persistence
import (
	"context"
	"time"
)

const (
	NotificationLike    = "like"
	NotificationDislike = "dislike"
	NotificationReply   = "reply"
	NotificationQuote   = "quote"
	NotificationFollow  = "follow"
)

type NotificationPost struct {
	ID    string  `json:"id"`
	Text  string  `json:"text"`
	Media []Media `json:"media"`
}

type Notification struct {
	ID        string            `json:"id"`
	Kind      string            `json:"kind"`
	Actor     Author            `json:"actor"`
	Post      *NotificationPost `json:"post"`
	CreatedAt time.Time         `json:"createdAt"`
	ReadAt    *time.Time        `json:"readAt"`
}

type NotificationSummary struct {
	UnreadCount int64 `json:"unreadCount"`
}

type NotificationPage struct {
	Items       []Notification `json:"items"`
	NextCursor  *string        `json:"nextCursor"`
	Through     *string        `json:"through"`
	UnreadCount int64          `json:"unreadCount"`
}

type NotificationOptions struct {
	ViewerID string
	Cursor   *Cursor
	Limit    int
}

type NotificationReadState struct {
	ID          string    `json:"id"`
	ReadAt      time.Time `json:"readAt"`
	UnreadCount int64     `json:"unreadCount"`
}

type NotificationStore interface {
	Notifications(context.Context, NotificationOptions) (NotificationPage, error)
	NotificationSummary(context.Context, string) (NotificationSummary, error)
	ReadNotification(context.Context, string, string) (NotificationReadState, error)
	ReadNotificationsThrough(context.Context, string, Cursor) (NotificationSummary, error)
}
