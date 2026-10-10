package postgres

// Covers device-key custody, recovery replacement and owner-only ciphertext stores against PostgreSQL
import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/memoro"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondo"
	"github.com/druckheil/Kaordo/services/kerno/internal/vault"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testAccount holds the account signing key a real device would keep after unlocking
type testAccount struct {
	id     string
	signer ed25519.PrivateKey
}

func (account testAccount) sign(t *testing.T, parts ...string) string {
	t.Helper()
	return base64.StdEncoding.EncodeToString(ed25519.Sign(account.signer, []byte(strings.Join(parts, "\n"))))
}

func registerTestAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, subject string) (testAccount, string) {
	t.Helper()
	user, err := NewUsers(pool).Upsert(ctx, subject, subject, subject)
	if err != nil {
		t.Fatal(err)
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	deviceID := uuid.NewString()
	_, err = NewEncryption(pool).Register(ctx, user.ID, "session-first", encryption.Registration{
		ID: deviceID, PublicKey: randomBase64(t, 32), EncryptionPublicKey: randomBase64(t, 32),
		SigningPublicKey: base64.StdEncoding.EncodeToString(public), WrappedKeys: randomBase64(t, 128),
	})
	if err != nil {
		t.Fatal(err)
	}
	return testAccount{id: user.ID, signer: private}, deviceID
}

func TestEncryptionDeviceCustody(t *testing.T) {
	ctx, pool := testDatabase(t)
	store := NewEncryption(pool)
	account, firstDevice := registerTestAccount(t, ctx, pool, "crypto-custody")

	identity, err := store.Identity(ctx, account.id)
	if err != nil || identity == nil || len(identity.Devices) != 1 || identity.Devices[0].WrappedKeys == "" {
		t.Fatalf("first device = %+v, %v", identity, err)
	}
	if _, err := store.Register(ctx, account.id, "session-first", encryption.Registration{ID: firstDevice, PublicKey: randomBase64(t, 32)}); !errors.Is(err, encryption.ErrConflict) {
		t.Fatalf("device key replacement = %v", err)
	}

	// A new browser registers only its public key and waits for a signed transfer.
	pending := encryption.Registration{ID: uuid.NewString(), PublicKey: randomBase64(t, 32)}
	registered, err := store.Register(ctx, account.id, "session-pending", pending)
	if err != nil || len(registered.Devices) != 2 {
		t.Fatalf("pending device = %+v, %v", registered, err)
	}
	wrapped := randomBase64(t, 128)
	forged := encryption.Approval{WrappedKeys: wrapped, Signature: randomBase64(t, 64)}
	if _, err := store.Approve(ctx, account.id, "session-first", pending.ID, forged); !errors.Is(err, encryption.ErrInvalid) {
		t.Fatalf("unsigned approval = %v", err)
	}
	approval := encryption.Approval{WrappedKeys: wrapped,
		Signature: account.sign(t, "kaordo-device-v1", account.id, pending.ID, pending.PublicKey, wrapped)}
	// The first device approves the new one from its own session
	approved, err := store.Approve(ctx, account.id, "session-first", pending.ID, approval)
	if err != nil {
		t.Fatal(err)
	}
	for _, device := range approved.Devices {
		want := map[string][2]string{firstDevice: {"session-first", encryption.UnlockedByAccount},
			pending.ID: {"session-pending", encryption.UnlockedByDevice}}[device.ID]
		if device.SessionID != want[0] || device.UnlockedWith != want[1] || device.UnlockedAt == nil {
			t.Fatalf("approved device %+v, want session and method %v", device, want)
		}
		if device.ID == pending.ID && device.WrappedKeys != wrapped {
			t.Fatalf("approved device bundle = %q", device.WrappedKeys)
		}
	}

	// A device that unlocks itself in its own session used the recovery key
	restoring := encryption.Registration{ID: uuid.NewString(), PublicKey: randomBase64(t, 32)}
	if _, err := store.Register(ctx, account.id, "session-old", restoring); err != nil {
		t.Fatal(err)
	}
	if err := store.UseDevice(ctx, account.id, "session-restoring", restoring.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.UseDevice(ctx, account.id, "session-restoring", uuid.NewString()); !errors.Is(err, encryption.ErrNotFound) {
		t.Fatalf("use unknown device = %v", err)
	}
	restored := randomBase64(t, 128)
	self := encryption.Approval{WrappedKeys: restored,
		Signature: account.sign(t, "kaordo-device-v1", account.id, restoring.ID, restoring.PublicKey, restored)}
	recovered, err := store.Approve(ctx, account.id, "session-restoring", restoring.ID, self)
	if err != nil {
		t.Fatal(err)
	}
	for _, device := range recovered.Devices {
		if device.ID == restoring.ID && (device.UnlockedWith != encryption.UnlockedByRecovery || device.SessionID != "session-restoring") {
			t.Fatalf("recovered device = %+v", device)
		}
	}
	forget := encryption.DeviceRemoval{Signature: account.sign(t, "kaordo-device-forget-v1", account.id, restoring.ID, restoring.PublicKey, restored)}
	if _, err := store.ForgetDevice(ctx, account.id, restoring.ID, forget); err != nil {
		t.Fatal(err)
	}

	if _, err := store.ForgetDevice(ctx, account.id, uuid.NewString(), encryption.DeviceRemoval{Signature: randomBase64(t, 64)}); !errors.Is(err, encryption.ErrNotFound) {
		t.Fatalf("forget unknown device = %v", err)
	}
	removal := encryption.DeviceRemoval{Signature: account.sign(t, "kaordo-device-forget-v1", account.id, pending.ID, pending.PublicKey, wrapped)}
	remaining, err := store.ForgetDevice(ctx, account.id, pending.ID, removal)
	if err != nil || len(remaining.Devices) != 1 {
		t.Fatalf("forget device = %+v, %v", remaining, err)
	}

	for len(remaining.Devices) < 20 {
		if remaining, err = store.Register(ctx, account.id, "", encryption.Registration{ID: uuid.NewString(), PublicKey: randomBase64(t, 32)}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.Register(ctx, account.id, "", encryption.Registration{ID: uuid.NewString(), PublicKey: randomBase64(t, 32)}); !errors.Is(err, encryption.ErrLimit) {
		t.Fatalf("21st device = %v", err)
	}
}

func TestEncryptionRecoveryReplacement(t *testing.T) {
	ctx, pool := testDatabase(t)
	store := NewEncryption(pool)
	account, _ := registerTestAccount(t, ctx, pool, "crypto-recovery")
	update := func(expected, wrapped string) encryption.RecoveryUpdate {
		return encryption.RecoveryUpdate{ExpectedWrappedKeys: expected, WrappedKeys: wrapped,
			Signature: account.sign(t, "kaordo-recovery-v1", account.id, expected, wrapped)}
	}
	first := randomBase64(t, 128)
	if err := store.SetRecovery(ctx, account.id, encryption.RecoveryUpdate{WrappedKeys: first, Signature: randomBase64(t, 64)}); !errors.Is(err, encryption.ErrInvalid) {
		t.Fatalf("unsigned recovery = %v", err)
	}
	if err := store.SetRecovery(ctx, account.id, update("", first)); err != nil {
		t.Fatal(err)
	}
	// A stale device cannot overwrite a newer recovery bundle.
	if err := store.SetRecovery(ctx, account.id, update("", randomBase64(t, 128))); !errors.Is(err, encryption.ErrConflict) {
		t.Fatalf("stale recovery replacement = %v", err)
	}
	second := randomBase64(t, 128)
	if err := store.SetRecovery(ctx, account.id, update(first, second)); err != nil {
		t.Fatal(err)
	}
	if stored, err := store.Recovery(ctx, account.id); err != nil || stored != second {
		t.Fatalf("recovery bundle = %q, %v", stored, err)
	}
}

func TestVaultRevisionsAndOwnership(t *testing.T) {
	ctx, pool := testDatabase(t)
	store := NewVault(pool)
	owner, _ := registerTestAccount(t, ctx, pool, "vault-owner")
	other, _ := registerTestAccount(t, ctx, pool, "vault-other")
	tag := strings.Repeat("a", 64)
	envelope := func() encryption.PrivateEnvelope {
		return encryption.PrivateEnvelope{Nonce: randomBase64(t, 12), Ciphertext: randomBase64(t, 48)}
	}
	written, err := store.Commit(ctx, owner.id, vault.Transaction{Writes: []vault.Write{{Tag: tag, Revision: 0, PrivateEnvelope: envelope()}}})
	if err != nil || len(written) != 1 || written[0].Revision != 1 {
		t.Fatalf("first write = %+v, %v", written, err)
	}
	if _, err := store.Commit(ctx, owner.id, vault.Transaction{Writes: []vault.Write{{Tag: tag, Revision: 0, PrivateEnvelope: envelope()}}}); !errors.Is(err, encryption.ErrConflict) {
		t.Fatalf("stale write = %v", err)
	}
	if records, err := store.Read(ctx, other.id, []string{tag}); err != nil || len(records) != 0 {
		t.Fatalf("another account read %+v, %v", records, err)
	}
	if _, err := store.Commit(ctx, owner.id, vault.Transaction{Deletes: []vault.Delete{{Tag: tag, Revision: 1}}}); err != nil {
		t.Fatal(err)
	}
	if records, err := store.Read(ctx, owner.id, []string{tag}); err != nil || len(records) != 0 {
		t.Fatalf("deleted record = %+v, %v", records, err)
	}
}

func TestMemoroDayRevisions(t *testing.T) {
	ctx, pool := testDatabase(t)
	store := NewMemoro(pool)
	owner, _ := registerTestAccount(t, ctx, pool, "memoro-owner")
	other, _ := registerTestAccount(t, ctx, pool, "memoro-other")
	dayTag, monthTag := strings.Repeat("d", 64), strings.Repeat("e", 64)
	update := func(revision int64) memoro.DayUpdate {
		return memoro.DayUpdate{MonthTag: monthTag, Revision: revision,
			Envelope: memoro.Envelope{Nonce: randomBase64(t, 12), Ciphertext: randomBase64(t, 64)},
			Summary:  memoro.Envelope{Nonce: randomBase64(t, 12), Ciphertext: randomBase64(t, 32)}}
	}
	saved, err := store.SaveDay(ctx, owner.id, dayTag, update(0), nil)
	if err != nil || saved.Revision != 1 {
		t.Fatalf("first save = %+v, %v", saved, err)
	}
	if _, err := store.SaveDay(ctx, owner.id, dayTag, update(0), nil); !errors.Is(err, memoro.ErrConflict) {
		t.Fatalf("stale save = %v", err)
	}
	if saved, err = store.SaveDay(ctx, owner.id, dayTag, update(1), nil); err != nil || saved.Revision != 2 {
		t.Fatalf("second save = %+v, %v", saved, err)
	}
	if month, err := store.Month(ctx, owner.id, monthTag); err != nil || len(month) != 1 || month[0].Revision != 2 {
		t.Fatalf("month = %+v, %v", month, err)
	}
	if day, err := store.Day(ctx, other.id, dayTag); err != nil || day != nil {
		t.Fatalf("another account read %+v, %v", day, err)
	}
}

func TestEncryptionAudiences(t *testing.T) {
	ctx, pool := testDatabase(t)
	store, rondoStore := NewEncryption(pool), NewRondo(pool)
	owner, _ := registerTestAccount(t, ctx, pool, "audience-owner")
	member, _ := registerTestAccount(t, ctx, pool, "audience-member")
	outsider, _ := registerTestAccount(t, ctx, pool, "audience-outsider")
	users := func(audience encryption.Audience) []string {
		ids := make([]string, 0, len(audience.Users))
		for _, user := range audience.Users {
			ids = append(ids, user.ID)
		}
		return slices.Sorted(slices.Values(ids))
	}
	members := slices.Sorted(slices.Values([]string{owner.id, member.id}))

	duo, err := NewLigo(pool).CreateConversation(ctx, owner.id, ligo.NewConversation{Kind: "duo", ParticipantIDs: []string{member.id}})
	if err != nil {
		t.Fatal(err)
	}
	if audience, err := store.Audience(ctx, owner.id, "ligo", duo.ID, false); err != nil || audience.Public || !slices.Equal(users(audience), members) {
		t.Fatalf("conversation audience = %+v, %v", audience, err)
	}
	if _, err := store.Audience(ctx, outsider.id, "ligo", duo.ID, false); !errors.Is(err, encryption.ErrNotFound) {
		t.Fatalf("outsider conversation audience = %v", err)
	}

	private, err := rondoStore.Create(ctx, owner.id, rondo.NewServer{Name: "Audience team", Access: "private"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rondoStore.Invite(ctx, owner.id, private.Server.ID, member.id); err != nil {
		t.Fatal(err)
	}
	if audience, err := store.Audience(ctx, member.id, "rondo", private.Server.ID, false); err != nil || audience.Public || !slices.Equal(users(audience), members) {
		t.Fatalf("private server audience = %+v, %v", audience, err)
	}
	if _, err := store.Audience(ctx, outsider.id, "rondo", private.Server.ID, false); !errors.Is(err, encryption.ErrNotFound) {
		t.Fatalf("outsider server audience = %v", err)
	}

	// A public server needs only its owner's key unless the content itself is private
	public, err := rondoStore.Create(ctx, owner.id, rondo.NewServer{Name: "Audience lobby", Access: "public"})
	if err != nil {
		t.Fatal(err)
	}
	if audience, err := store.Audience(ctx, owner.id, "rondo", public.Server.ID, false); err != nil || !audience.Public || !slices.Equal(users(audience), []string{owner.id}) {
		t.Fatalf("public server audience = %+v, %v", audience, err)
	}
	if audience, err := store.Audience(ctx, owner.id, "rondo", public.Server.ID, true); err != nil || audience.Public || !slices.Equal(users(audience), []string{owner.id}) {
		t.Fatalf("private content on a public server = %+v, %v", audience, err)
	}
	if _, err := store.Audience(ctx, owner.id, "unknown", duo.ID, false); !errors.Is(err, encryption.ErrInvalid) {
		t.Fatalf("unknown audience module = %v", err)
	}
}
