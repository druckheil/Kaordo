package rondo

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

type Channel struct {
	ID             string    `json:"id"`
	ServerID       string    `json:"serverId"`
	ConversationID string    `json:"conversationId"`
	Name           string    `json:"name"`
	Position       int       `json:"position"`
	CreatedAt      time.Time `json:"createdAt"`
}

type Detail struct {
	Server   Server      `json:"server"`
	Channels []Channel   `json:"channels"`
	Members  []ligo.User `json:"members"`
}

type NewServer struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Access      string `json:"access"`
}

type Store interface {
	List(context.Context, string, string) ([]Server, error)
	Discover(context.Context, string, string) ([]Server, error)
	Create(context.Context, string, NewServer) (Detail, error)
	Get(context.Context, string, string) (Detail, error)
	Join(context.Context, string, string) (Detail, error)
	Invite(context.Context, string, string, string) (Detail, error)
	Leave(context.Context, string, string) ([]string, error)
	CreateChannel(context.Context, string, string, string) (Channel, error)
	VoiceChannel(context.Context, string, string) (Channel, error)
}
