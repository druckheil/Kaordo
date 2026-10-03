package postgres

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAdminAccessFlow(t *testing.T) {
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
	if _, err := pool.Exec(ctx, `INSERT INTO user_roles (user_id, role) VALUES ($1::uuid, 'admin') ON CONFLICT DO NOTHING`, admin.ID); err != nil {
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
	listed, err := store.Users(ctx, "regadotarget")
	if err != nil || len(listed) != 1 || listed[0].ID != target.ID {
		t.Fatalf("users = %+v, %v", listed, err)
	}
	if _, err := store.SetDisabled(ctx, admin.ID, admin.ID, true, "self lockout attempt"); !errors.Is(err, ErrAdminTarget) {
		t.Fatalf("self disable = %v", err)
	}
	if _, err := store.SetAdmin(ctx, admin.ID, admin.ID, false, "self revocation attempt"); !errors.Is(err, ErrAdminTarget) {
		t.Fatalf("self role change = %v", err)
	}
	promoted, err := store.SetAdmin(ctx, admin.ID, target.ID, true, "Assign administrator responsibilities")
	if err != nil || !promoted.IsAdmin {
		t.Fatalf("role grant = %+v, %v", promoted, err)
	}
	if _, err := store.SetDisabled(ctx, admin.ID, target.ID, true, "disable privileged target"); !errors.Is(err, ErrAdminTarget) {
		t.Fatalf("administrator was disabled: %v", err)
	}
	revoked, err := store.SetAdmin(ctx, admin.ID, target.ID, false, "Administrator responsibilities concluded")
	if err != nil || revoked.IsAdmin {
		t.Fatalf("role revocation = %+v, %v", revoked, err)
	}
	reason := "Investigating a documented policy violation"
	accessCase, err := store.CreateAccessCase(ctx, admin.ID, target.ID, reason)
	if err != nil {
		t.Fatal(err)
	}
	if accessCase.TargetUserID != target.ID {
		t.Fatalf("case target = %+v", accessCase)
	}
	if _, err := store.AccessCase(ctx, target.ID, accessCase.ID); err == nil {
		t.Fatal("target opened admin case")
	}
	if _, err := store.AccessCase(ctx, admin.ID, accessCase.ID); err != nil {
		t.Fatal(err)
	}
	var noticeID string
	if err := pool.QueryRow(ctx, `SELECT m.id::text FROM ligo_messages m
		JOIN ligo_conversations c ON c.id = m.conversation_id
		WHERE c.kind = 'self' AND c.created_by = $1::uuid AND m.system_notice
		ORDER BY m.created_at DESC LIMIT 1`, target.ID).Scan(&noticeID); err != nil {
		t.Fatal(err)
	}
	var conversationID string
	if err := pool.QueryRow(ctx, `SELECT conversation_id::text FROM ligo_messages WHERE id = $1::uuid`, noticeID).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	message, err := NewLigo(pool).message(ctx, target.ID, noticeID)
	if err != nil || !message.SystemNotice || !strings.Contains(message.Text, accessCase.ID) {
		t.Fatalf("notice = %+v, %v", message, err)
	}
	saved, err := NewLigo(pool).GetConversation(ctx, target.ID, conversationID)
	if err != nil || saved.UnreadCount != 1 || saved.LastMessage == nil || saved.LastMessage.ID != noticeID {
		t.Fatalf("Saved messages notification = %+v, %v", saved, err)
	}
	if _, err := NewLigo(pool).Edit(ctx, target.ID, conversationID, noticeID, "hide notice"); err == nil {
		t.Fatal("notice was editable")
	}
	if _, err := NewLigo(pool).DeleteMessage(ctx, target.ID, conversationID, noticeID); err == nil {
		t.Fatal("notice was deletable")
	}
	if _, err := NewLigo(pool).SetReaction(ctx, target.ID, conversationID, noticeID, "heart", true); err == nil {
		t.Fatal("system notice accepted a reaction")
	}
	page, err := store.CaseContent(ctx, target.ID, "messages", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range page.Items {
		if item.ID == noticeID {
			t.Fatal("system notice leaked into inspected content")
		}
	}
	if _, err := store.CaseContent(ctx, target.ID, "posts", ""); err != nil {
		t.Fatal(err)
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
	if err := store.CloseCase(ctx, target.ID, accessCase.ID); err == nil {
		t.Fatal("target closed another actor's case")
	}
	if err := store.CloseCase(ctx, admin.ID, accessCase.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AccessCase(ctx, admin.ID, accessCase.ID); err == nil {
		t.Fatal("closed case still allowed access")
	}
	if err := store.CloseCase(ctx, admin.ID, accessCase.ID); err != nil {
		t.Fatal("case closure is not idempotent:", err)
	}
	if err := store.Record(ctx, admin.ID, target.ID, "case.read", reason, map[string]string{"caseId": accessCase.ID}); err != nil {
		t.Fatal(err)
	}
	if err := store.Record(ctx, admin.ID, "", "log.read", "", map[string]string{"service": "kerno"}); err != nil {
		t.Fatal(err)
	}
	entries, err := store.Audit(ctx)
	if err != nil || len(entries) < 3 {
		t.Fatalf("audit = %+v, %v", entries, err)
	}
	for _, entry := range entries {
		if entry.Action == "case.read" && (entry.Target == nil || *entry.Target != target.Username) {
			t.Fatalf("content read lost its target: %+v", entry)
		}
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
	if _, err := pool.Exec(ctx, `INSERT INTO user_roles (user_id, role) VALUES ($1::uuid, 'admin'), ($2::uuid, 'admin')`, a.ID, b.ID); err != nil {
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
		} else if !errors.Is(err, ErrAdminTarget) {
			t.Fatal(err)
		}
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM user_roles WHERE user_id = ANY($1::uuid[])`, []string{a.ID, b.ID}).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if success != 1 || count != 1 {
		t.Fatalf("mutual revocation: success %d, remaining administrators %d", success, count)
	}
}
