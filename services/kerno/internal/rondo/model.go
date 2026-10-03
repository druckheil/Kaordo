package rondo

// Defines Rondo API models, store operations, and domain errors
import (
	"context"
	"errors"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
)

var (
	ErrNotFound  = errors.New("server or channel not found")
	ErrForbidden = errors.New("server ownership or membership required")
	ErrInvalid   = errors.New("invalid Rondo request")
	ErrConflict  = errors.New("Rondo resource already exists")
	ErrLimit     = errors.New("Rondo capacity limit reached")
)

// Server is a Rondo server and the current user's membership state
type Server struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Access      string    `json:"access"`
	OwnerID     string    `json:"ownerId"`
	MemberCount int       `json:"memberCount"`
	Joined      bool      `json:"joined"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Channel is a text or voice conversation attached to a server
type Channel struct {
	ID             string    `json:"id"`
	ServerID       string    `json:"serverId"`
	ConversationID string    `json:"conversationId"`
	Name           string    `json:"name"`
	Position       int       `json:"position"`
	CreatedAt      time.Time `json:"createdAt"`
}

// Detail combines a server with its channels and visible members
type Detail struct {
	Server   Server      `json:"server"`
	Channels []Channel   `json:"channels"`
	Members  []ligo.User `json:"members"`
}

// NewServer contains the fields accepted when creating a server
type NewServer struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Access      string `json:"access"`
}

// Store defines the persistence operations used by the Rondo API
type Store interface {
	List(ctx context.Context, actorID, search string) ([]Server, error)
	Discover(ctx context.Context, actorID, search string) ([]Server, error)
	Create(ctx context.Context, actorID string, input NewServer) (Detail, error)
	Get(ctx context.Context, actorID, serverID string) (Detail, error)
	Join(ctx context.Context, actorID, serverID string) (Detail, error)
	Invite(ctx context.Context, actorID, serverID, userID string) (Detail, error)
	Leave(ctx context.Context, actorID, serverID string) ([]string, error)
	CreateChannel(ctx context.Context, actorID, serverID, name string) (Channel, error)
	VoiceChannel(ctx context.Context, actorID, channelID string) (Channel, error)
}
