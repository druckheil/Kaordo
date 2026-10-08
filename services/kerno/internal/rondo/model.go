package rondo

// Defines Rondo API models, store operations, and domain errors
import (
	"context"
	"encoding/json"
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

type ServerPage struct {
	Items      []Server `json:"items"`
	NextCursor *string  `json:"nextCursor"`
}

type DiscoveryStore interface {
	DiscoverPage(context.Context, string, string) (ServerPage, error)
}

// NewServer contains the fields accepted when creating a server
type NewServer struct {
	ID          string `json:"id"`
	GeneralID   string `json:"generalId"`
	General     string `json:"general"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Access      string `json:"access"`
}

type EncryptedMetadata struct {
	ExpectedName string            `json:"expectedName"`
	Name         string            `json:"name"`
	Channels     map[string]string `json:"channels"`
}
type VoiceKey struct {
	Revision      int64           `json:"revision"`
	MembershipTag string          `json:"membershipTag"`
	Envelope      json.RawMessage `json:"envelope"`
}
type EncryptedStore interface {
	InviteEncrypted(context.Context, string, string, string, EncryptedMetadata) (Detail, error)
	CreateEncryptedChannel(context.Context, string, string, string, string) (Channel, error)
	VoiceKey(context.Context, string, string) (VoiceKey, error)
	SetVoiceKey(context.Context, string, string, VoiceKey) (VoiceKey, error)
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
