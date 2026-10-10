package postgres

// Verifies per-account storage by application, the weekly additions and the database footprint
import (
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"

	jetpg "github.com/go-jet/jet/v2/postgres"
)

func TestDataUsageAttributesStorageToAccountsAndApplications(t *testing.T) {
	ctx, pool := testDatabase(t)
	users := NewUsers(pool)
	heavy, err := users.Upsert(ctx, "usage-heavy", "usageheavy", "Heavy")
	if err != nil {
		t.Fatal(err)
	}
	light, err := users.Upsert(ctx, "usage-light", "usagelight", "Light")
	if err != nil {
		t.Fatal(err)
	}
	// Ciphertext is incompressible; random text keeps TOAST from shrinking the stored rows
	sealed := func(length int) string {
		raw := make([]byte, length)
		_, _ = rand.Read(raw)
		return base64.StdEncoding.EncodeToString(raw)[:length]
	}
	tag := strings.Repeat("a", 64)
	key := strings.Repeat("k", 44)
	seed := []string{
		// A post with one 3 MB file, old enough not to count as this week's
		`INSERT INTO fluo_posts (id, author_id, content, plain_text, visibility, created_at)
			VALUES ('01999111-0000-7000-8000-000000000001', '` + heavy.ID + `', '{}', '', 'public', now() - interval '30 days')`,
		`INSERT INTO nodo_upload_claims (upload_id, owner_id) VALUES ('01999111-0000-7000-8000-0000000000a1', '` + heavy.ID + `')`,
		`INSERT INTO fluo_post_media (post_id, upload_id, position, kind, mime_type, width, height, size_bytes)
			VALUES ('01999111-0000-7000-8000-000000000001', '01999111-0000-7000-8000-0000000000a1', 0, 'file', 'application/octet-stream', 0, 0, 3000000)`,
		// A direct message and a channel message, each with a file sent this week
		`INSERT INTO ligo_conversations (id, kind, created_by, duo_low, duo_high)
			VALUES ('01999111-0000-7000-8000-000000000010', 'duo', '` + heavy.ID + `', '` + min(heavy.ID, light.ID) + `', '` + max(heavy.ID, light.ID) + `')`,
		`INSERT INTO ligo_conversations (id, kind, title, created_by) VALUES ('01999111-0000-7000-8000-000000000011', 'channel', '', '` + heavy.ID + `')`,
		`INSERT INTO ligo_messages (id, conversation_id, sender_id, client_id, body)
			VALUES ('01999111-0000-7000-8000-000000000020', '01999111-0000-7000-8000-000000000010', '` + heavy.ID + `', '01999111-0000-7000-8000-000000000030', 'sealed message')`,
		`INSERT INTO ligo_messages (id, conversation_id, sender_id, client_id, body)
			VALUES ('01999111-0000-7000-8000-000000000021', '01999111-0000-7000-8000-000000000011', '` + heavy.ID + `', '01999111-0000-7000-8000-000000000031', 'sealed channel message')`,
		`INSERT INTO ligo_message_media (message_id, upload_id, position, kind, mime_type, filename, width, height, size_bytes)
			VALUES ('01999111-0000-7000-8000-000000000020', '01999111-0000-7000-8000-0000000000b1', 0, 'file', 'application/octet-stream', 'a.bin', 0, 0, 2000000)`,
		`INSERT INTO ligo_message_media (message_id, upload_id, position, kind, mime_type, filename, width, height, size_bytes)
			VALUES ('01999111-0000-7000-8000-000000000021', '01999111-0000-7000-8000-0000000000b2', 0, 'file', 'application/octet-stream', 'b.bin', 0, 0, 1000000)`,
		// The light account keeps one encrypted journal day and a learning record
		`INSERT INTO crypto_accounts (user_id, encryption_public_key, signing_public_key) VALUES ('` + light.ID + `', '` + key + `', '` + key + `')`,
		`INSERT INTO memoro_days (user_id, day_tag, month_tag, nonce, ciphertext, summary_nonce, summary_ciphertext)
			VALUES ('` + light.ID + `', '` + tag + `', '` + tag + `', '` + strings.Repeat("n", 16) + `', '` + sealed(4000) + `', '` + strings.Repeat("n", 16) + `', '` + strings.Repeat("s", 24) + `')`,
		`INSERT INTO private_records (user_id, tag, nonce, ciphertext)
			VALUES ('` + light.ID + `', '` + tag + `', '` + strings.Repeat("n", 16) + `', '` + sealed(3000) + `')`,
	}
	// Tests share one database: remove the seeded content so feeds and counts elsewhere stay exact
	t.Cleanup(func() {
		for _, statement := range []string{
			`DELETE FROM ligo_messages WHERE sender_id = '` + heavy.ID + `'`,
			`DELETE FROM ligo_conversations WHERE created_by = '` + heavy.ID + `'`,
			`DELETE FROM fluo_posts WHERE author_id = '` + heavy.ID + `'`,
			`DELETE FROM nodo_upload_claims WHERE owner_id = '` + heavy.ID + `'`,
			`DELETE FROM crypto_accounts WHERE user_id = '` + light.ID + `'`,
		} {
			if _, err := jetExec(ctx, pool, jetpg.RawStatement(statement)); err != nil {
				t.Errorf("%v: %s", err, statement)
			}
		}
	})
	for _, statement := range seed {
		if _, err := jetExec(ctx, pool, jetpg.RawStatement(statement)); err != nil {
			t.Fatalf("%v: %s", err, statement)
		}
	}

	usage, err := NewAdmin(pool).DataUsage(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(usage.Users) < 2 || usage.Users[0].ID != heavy.ID {
		t.Fatalf("the largest account is not first: %+v", usage.Users)
	}
	first := usage.Users[0]
	if first.Media.Posts != 3000000 || first.Media.Messages != 2000000 || first.Media.Channels != 1000000 {
		t.Fatalf("media by application = %+v", first.Media)
	}
	if first.Records.Messages <= 0 || first.Records.Channels <= 0 || first.Records.Posts <= 0 {
		t.Fatalf("records by application = %+v", first.Records)
	}
	// Both message files and both messages arrived this week; the 30-day-old post did not
	if first.AddedWeek < 3000000 || first.AddedWeek >= 6000000 {
		t.Fatalf("added this week = %d", first.AddedWeek)
	}
	if first.Total != first.Media.Posts+first.Media.Messages+first.Media.Channels+first.Records.Posts+first.Records.Messages+first.Records.Channels {
		t.Fatalf("total = %d for %+v", first.Total, first)
	}
	var second *struct{ journal, learning int64 }
	for _, user := range usage.Users {
		if user.ID == light.ID {
			second = &struct{ journal, learning int64 }{user.Records.Journal, user.Records.Learning}
		}
	}
	if second == nil || second.journal < 4000 || second.learning < 3000 {
		t.Fatalf("journal and learning records = %+v", second)
	}
	if usage.ReferencedUploads != 3 || usage.ReferencedMedia != 6000000 {
		t.Fatalf("referenced media = %d uploads, %d bytes", usage.ReferencedUploads, usage.ReferencedMedia)
	}
	if len(usage.Databases) == 0 || usage.Databases[0].Bytes <= 0 || len(usage.Tables) == 0 {
		t.Fatalf("database footprint = %+v %+v", usage.Databases, usage.Tables)
	}
}
