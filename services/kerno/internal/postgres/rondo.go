package postgres

// Provides the PostgreSQL-backed Rondo store
import "github.com/jackc/pgx/v5/pgxpool"

type Rondo struct {
	pool *pgxpool.Pool
}

func NewRondo(pool *pgxpool.Pool) *Rondo {
	return &Rondo{pool: pool}
}
