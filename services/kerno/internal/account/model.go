package account

// Defines application identity independently of persistence and HTTP
import (
	"context"
	"errors"
	"time"
)

var ErrNotFound = errors.New("account record not found")

type User struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"displayName"`
	CreatedAt   time.Time  `json:"createdAt"`
	IsAdmin     bool       `json:"isAdmin"`
	DisabledAt  *time.Time `json:"-"`
}

type Store interface {
	Upsert(context.Context, string, string, string) (User, error)
	BySubject(context.Context, string) (User, error)
}
