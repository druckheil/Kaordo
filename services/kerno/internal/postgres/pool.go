package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Open creates the database pool after deployment configuration is supplied.
func Open(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	return pgxpool.New(ctx, dsn)
}
