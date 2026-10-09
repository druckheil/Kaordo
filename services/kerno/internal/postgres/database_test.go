package postgres

// Connects tests to the disposable database created by scripts/product-db.integration.mjs
import (
	"context"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

var migrateTestDatabase = sync.OnceValue(func() error {
	pool, err := pgxpool.New(context.Background(), os.Getenv("KAORDO_TEST_DATABASE_URL"))
	if err != nil {
		return err
	}
	defer pool.Close()
	return Migrate(context.Background(), pool)
})

func testDatabase(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("KAORDO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set KAORDO_TEST_DATABASE_URL to an isolated test database")
	}
	if err := migrateTestDatabase(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return ctx, pool
}
