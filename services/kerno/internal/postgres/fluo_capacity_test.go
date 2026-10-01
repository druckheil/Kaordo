package postgres

import (
	"context"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/jackc/pgx/v5/pgxpool"
)

// This measures the actual List path in a disposable database. Timings are
// evidence for a particular machine, not a portable pass/fail threshold.
func TestFluoReadCapacity(t *testing.T) {
	dsn := os.Getenv("KAORDO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set KAORDO_TEST_DATABASE_URL to an isolated migrated test database")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	defer func() {
		if _, err := pool.Exec(ctx, `DELETE FROM users WHERE keycloak_sub LIKE 'capacity-user-%'`); err != nil {
			t.Errorf("remove capacity fixtures: %v", err)
		}
	}()
	_, err = pool.Exec(ctx, `INSERT INTO users (keycloak_sub, username, display_name)
		SELECT 'capacity-user-' || i, 'capacity_user_' || i, 'Capacity user ' || i
		FROM generate_series(1, 100) AS i`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `WITH authors AS (
		SELECT id, row_number() OVER (ORDER BY id) AS position FROM users
		WHERE keycloak_sub LIKE 'capacity-user-%'
	)
	INSERT INTO fluo_posts (author_id, content, plain_text, visibility)
	SELECT authors.id, '{"type":"doc"}'::jsonb,
		CASE WHEN number = 10000 THEN 'unique capacity needle' ELSE 'bulk post ' || number END,
		'public'
	FROM generate_series(1, 20000) AS number
	JOIN authors ON authors.position = (number % 100) + 1`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `ANALYZE fluo_posts`); err != nil {
		t.Fatal(err)
	}
	var viewerID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM users WHERE keycloak_sub = 'capacity-user-1'`).Scan(&viewerID); err != nil {
		t.Fatal(err)
	}
	store := NewFluo(pool)
	for _, scenario := range []struct {
		name, search string
		want         int
	}{
		{name: "latest", want: 20},
		{name: "selective-search", search: "unique capacity needle", want: 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			durations := make([]time.Duration, 40)
			for i := range durations {
				start := time.Now()
				page, err := store.List(ctx, fluo.ListOptions{ViewerID: viewerID, Feed: "latest", Search: scenario.search, Limit: 20})
				durations[i] = time.Since(start)
				if err != nil || len(page.Items) != scenario.want {
					t.Fatalf("page count = %d, error = %v", len(page.Items), err)
				}
			}
			sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
			t.Logf("20,000 posts / 100 authors / 40 reads: p50=%s p95=%s max=%s", durations[19], durations[37], durations[39])
		})
	}
}
