package postgres

import (
	"context"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
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
		users := table.Users
		if _, err := jetExec(ctx, pool, users.DELETE().WHERE(users.KeycloakSub.LIKE(jetpg.String("capacity-user-%")))); err != nil {
			t.Errorf("remove capacity fixtures: %v", err)
		}
	}()
	users := NewUsers(pool)
	userIDs := make([]string, 100)
	for index := range userIDs {
		user, err := users.Upsert(ctx, fmt.Sprintf("capacity-user-%d", index+1),
			fmt.Sprintf("capacity_user_%d", index+1), fmt.Sprintf("Capacity user %d", index+1))
		if err != nil {
			t.Fatal(err)
		}
		userIDs[index] = user.ID
	}
	posts := table.FluoPosts
	for start := 1; start <= 20000; start += 1000 {
		statement := posts.INSERT(posts.AuthorID, posts.Content, posts.PlainText, posts.Visibility)
		for number := start; number < start+1000 && number <= 20000; number++ {
			body := fmt.Sprintf("bulk post %d", number)
			if number == 10000 {
				body = "unique capacity needle"
			}
			statement = statement.VALUES(jetUUID(userIDs[number%100]), jetpg.Json([]byte(`{"type":"doc"}`)),
				jetpg.String(body), jetpg.String("public"))
		}
		if _, err := jetExec(ctx, pool, statement); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := jetExec(ctx, pool, jetpg.RawStatement("ANALYZE fluo_posts")); err != nil {
		t.Fatal(err)
	}
	var viewerID string
	if err := jetQueryRow(ctx, pool, table.Users.SELECT(jetpg.CAST(table.Users.ID).AS_TEXT()).
		WHERE(table.Users.KeycloakSub.EQ(jetpg.String("capacity-user-1")))).Scan(&viewerID); err != nil {
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
