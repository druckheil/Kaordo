package ligo

// Defines Ligo domain models, request inputs, and store contracts
import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"time"
)

const maxEncodedConversationCursorLength = 256

var (
	ErrNotFound    = errors.New("conversation or account not found")
	ErrForbidden   = errors.New("conversation membership required")
	ErrInvalid     = errors.New("invalid conversation request")
	ErrRateLimited = errors.New("sending too quickly")
	ErrMediaOwner  = errors.New("attachment belongs to another account")
)

var errInvalidConversationCursor = errors.New("invalid conversation cursor")

type User struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type Media struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	MimeType string `json:"mimeType"`
	Filename string `json:"filename"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Size     int64  `json:"size"`
	AltText  string `json:"altText"`
	URL      string `json:"url,omitempty"`
}

type Reaction struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
	Mine  bool   `json:"mine"`
}

type Message struct {
	ID             string     `json:"id"`
	ConversationID string     `json:"conversationId"`
	ClientID       string     `json:"clientId"`
	Sender         User       `json:"sender"`
	Text           string     `json:"text"`
	Media          []Media    `json:"media"`
	Reactions      []Reaction `json:"reactions"`
	Status         string     `json:"status"`
	EditedAt       *time.Time `json:"editedAt"`
	Deleted        bool       `json:"deleted"`
	SystemNotice   bool       `json:"systemNotice"`
	CreatedAt      time.Time  `json:"createdAt"`
}

type MessagePreview struct {
	ID        string    `json:"id"`
	Text      string    `json:"text"`
	SenderID  string    `json:"senderId"`
	Deleted   bool      `json:"deleted"`
	CreatedAt time.Time `json:"createdAt"`
}

type Conversation struct {
	ID          string          `json:"id"`
	Kind        string          `json:"kind"`
	Title       string          `json:"title"`
	CreatedBy   string          `json:"createdBy"`
	Members     []User          `json:"members"`
	LastMessage *MessagePreview `json:"lastMessage"`
	UnreadCount int             `json:"unreadCount"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

type Page struct {
	Items      []Message `json:"items"`
	NextCursor *string   `json:"nextCursor"`
}

type ConversationPage struct {
	Items      []Conversation `json:"items"`
	NextCursor *string        `json:"nextCursor"`
}

type ConversationCursor struct {
	UpdatedAt time.Time `json:"updatedAt"`
	ID        string    `json:"id"`
}

var conversationCursorIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func EncodeConversationCursor(item Conversation) string {
	data, err := json.Marshal(ConversationCursor{UpdatedAt: item.UpdatedAt, ID: item.ID})
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(data)
}

func DecodeConversationCursor(value string) (*ConversationCursor, error) {
	if value == "" {
		return nil, nil
	}
	if len(value) > maxEncodedConversationCursorLength {
		return nil, errInvalidConversationCursor
	}

	data, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, errInvalidConversationCursor
	}
	return parseConversationCursor(data)
}

func parseConversationCursor(data []byte) (*ConversationCursor, error) {
	var cursor ConversationCursor
	if err := json.Unmarshal(data, &cursor); err != nil {
		return nil, errInvalidConversationCursor
	}
	if cursor.UpdatedAt.IsZero() || !conversationCursorIDPattern.MatchString(cursor.ID) {
		return nil, errInvalidConversationCursor
	}
	return &cursor, nil
}

type NewConversation struct {
	Kind           string   `json:"kind"`
	Title          string   `json:"title"`
	ParticipantIDs []string `json:"participantIds"`
}

type NewMessage struct {
	ClientID      string            `json:"clientId"`
	Text          string            `json:"text"`
	AttachmentIDs []string          `json:"attachmentIds"`
	AltTexts      map[string]string `json:"altTexts"`
}

type Store interface {
	SearchUsers(context.Context, string, string) ([]User, error)
	CreateConversation(context.Context, string, NewConversation) (Conversation, error)
	ListConversations(context.Context, string, *ConversationCursor, int) (ConversationPage, error)
	GetConversation(context.Context, string, string) (Conversation, error)
	AddMembers(context.Context, string, string, []string) (Conversation, error)
	ListMessages(context.Context, string, string, string, int) (Page, error)
	Send(context.Context, string, string, NewMessage, []Media) (Message, error)
	Edit(context.Context, string, string, string, string) (Message, error)
	DeleteMessage(context.Context, string, string, string) ([]string, error)
	SetReaction(context.Context, string, string, string, string, bool) (Message, error)
	MarkDelivered(context.Context, string, string, string) error
	MarkRead(context.Context, string, string, string) error
	MemberIDs(context.Context, string) ([]string, error)
}
