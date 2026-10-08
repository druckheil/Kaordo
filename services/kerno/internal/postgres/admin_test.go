package postgres

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	adminmodel "github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAdminAccountActions(t *testing.T) {
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
	users := NewUsers(pool)
	admin, err := users.Upsert(ctx, "regado-admin", "regadoadmin", "Regado Admin")
	if err != nil {
		t.Fatal(err)
	}
	target, err := users.Upsert(ctx, "regado-target", "regadotarget", "Regado Target")
	if err != nil {
		t.Fatal(err)
	}
	roles := table.UserRoles
	if _, err := jetExec(ctx, pool, roles.INSERT(roles.UserID, roles.Role).
		VALUES(jetUUID(admin.ID), jetpg.String("admin")).ON_CONFLICT().DO_NOTHING()); err != nil {
		t.Fatal(err)
	}
	admin, err = users.BySubject(ctx, "regado-admin")
	if err != nil || !admin.IsAdmin {
		t.Fatalf("admin role lookup = %+v, %v", admin, err)
	}
	store := NewAdmin(pool)
	if _, err := store.Summary(ctx); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"regadotarget", "REGADOTARGET", " ReGaDoTaRgEt "} {
		listed, err := store.Users(ctx, query)
		if err != nil || len(listed) != 1 || listed[0].ID != target.ID {
			t.Fatalf("users for %q = %+v, %v", query, listed, err)
		}
	}
	if _, err := store.SetDisabled(ctx, admin.ID, admin.ID, true, "self lockout attempt"); !errors.Is(err, adminmodel.ErrTarget) {
		t.Fatalf("self disable = %v", err)
	}
	if _, err := store.SetAdmin(ctx, admin.ID, admin.ID, false, "self revocation attempt"); !errors.Is(err, adminmodel.ErrTarget) {
		t.Fatalf("self role change = %v", err)
	}
	promoted, err := store.SetAdmin(ctx, admin.ID, target.ID, true, "Assign administrator responsibilities")
	if err != nil || !promoted.IsAdmin {
		t.Fatalf("role grant = %+v, %v", promoted, err)
	}
	if _, err := store.SetDisabled(ctx, admin.ID, target.ID, true, "disable privileged target"); !errors.Is(err, adminmodel.ErrTarget) {
		t.Fatalf("administrator was disabled: %v", err)
	}
	revoked, err := store.SetAdmin(ctx, admin.ID, target.ID, false, "Administrator responsibilities concluded")
	if err != nil || revoked.IsAdmin {
		t.Fatalf("role revocation = %+v, %v", revoked, err)
	}
	changed, err := store.SetDisabled(ctx, admin.ID, target.ID, true, "Repeated policy violation")
	if err != nil || changed.DisabledAt == nil {
		t.Fatalf("disable = %+v, %v", changed, err)
	}
	bySubject, err := users.BySubject(ctx, "regado-target")
	if err != nil || bySubject.DisabledAt == nil {
		t.Fatalf("disabled session lookup = %+v, %v", bySubject, err)
	}
	if _, err := store.SetDisabled(ctx, admin.ID, target.ID, false, "Appeal was accepted"); err != nil {
		t.Fatal(err)
	}
	if err := store.Record(ctx, admin.ID, "", "log.read", "", map[string]string{"service": "kerno"}); err != nil {
		t.Fatal(err)
	}
	entries, err := store.Audit(ctx)
	if err != nil || len(entries) < 3 {
		t.Fatalf("audit = %+v, %v", entries, err)
	}
}

func TestAdminMutualRevocationPreservesAdministrator(t *testing.T) {
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
	users := NewUsers(pool)
	a, err := users.Upsert(ctx, "regado-race-a", "regadoracea", "Race A")
	if err != nil {
		t.Fatal(err)
	}
	b, err := users.Upsert(ctx, "regado-race-b", "regadoraceb", "Race B")
	if err != nil {
		t.Fatal(err)
	}
	roles := table.UserRoles
	if _, err := jetExec(ctx, pool, roles.INSERT(roles.UserID, roles.Role).
		VALUES(jetUUID(a.ID), jetpg.String("admin")).VALUES(jetUUID(b.ID), jetpg.String("admin"))); err != nil {
		t.Fatal(err)
	}
	store := NewAdmin(pool)
	var pending sync.WaitGroup
	results := make(chan error, 2)
	for _, pair := range [][2]string{{a.ID, b.ID}, {b.ID, a.ID}} {
		pending.Go(func() {
			_, err := store.SetAdmin(ctx, pair[0], pair[1], false, "Concurrent administrator role revocation")
			results <- err
		})
	}
	pending.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else if !errors.Is(err, adminmodel.ErrTarget) {
			t.Fatal(err)
		}
	}
	var count int
	if err := jetQueryRow(ctx, pool, jetpg.SELECT(jetpg.COUNT(roles.UserID)).FROM(roles).
		WHERE(roles.UserID.IN(jetUUID(a.ID), jetUUID(b.ID)))).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if success != 1 || count != 1 {
		t.Fatalf("mutual revocation: success %d, remaining administrators %d", success, count)
	}
}
