package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type User struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"displayName"`
	CreatedAt   time.Time  `json:"createdAt"`
	IsAdmin     bool       `json:"isAdmin"`
	DisabledAt  *time.Time `json:"-"`
}

type Users struct{ pool *pgxpool.Pool }

func NewUsers(pool *pgxpool.Pool) *Users { return &Users{pool: pool} }

func (store *Users) Upsert(ctx context.Context, subject, username, displayName string) (User, error) {
	var user User
	err := store.pool.QueryRow(ctx, `
		WITH updated AS (INSERT INTO users (keycloak_sub, username, display_name)
		VALUES ($1, $2, $3)
		ON CONFLICT (keycloak_sub) DO UPDATE
		SET username = EXCLUDED.username,
		    display_name = EXCLUDED.display_name,
		    updated_at = now()
		RETURNING id, username, display_name, created_at, disabled_at)
		SELECT u.id::text, u.username, u.display_name, u.created_at,
		EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'admin'), u.disabled_at
		FROM updated u
	`, subject, username, displayName).Scan(&user.ID, &user.Username, &user.DisplayName, &user.CreatedAt, &user.IsAdmin, &user.DisabledAt)
	return user, err
}

func (store *Users) BySubject(ctx context.Context, subject string) (User, error) {
	var user User
	err := store.pool.QueryRow(ctx, `
		SELECT u.id::text, u.username, u.display_name, u.created_at,
		EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'admin'), u.disabled_at
		FROM users u WHERE u.keycloak_sub = $1
	`, subject).Scan(&user.ID, &user.Username, &user.DisplayName, &user.CreatedAt, &user.IsAdmin, &user.DisabledAt)
	return user, err
}

func IsNotFound(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
