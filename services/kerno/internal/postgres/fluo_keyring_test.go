package postgres

// Covers audience key rotation, grants and the keyring checks applied to encrypted posts
import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fluoAuthor signs synthetic envelopes; Kerno never decrypts them, so ciphertext bytes are arbitrary
type fluoAuthor struct {
	id     string
	signer ed25519.PrivateKey
}

func randomBase64(t *testing.T, size int) string {
	t.Helper()
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(bytes)
}

func registerFluoAuthor(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) fluoAuthor {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := jetExec(ctx, pool, jetpg.RawStatement(`INSERT INTO crypto_accounts (user_id, encryption_public_key, signing_public_key)
		VALUES (#id::uuid, #box, #sign) ON CONFLICT (user_id) DO UPDATE SET signing_public_key = EXCLUDED.signing_public_key`,
		jetpg.RawArgs{"#id": id, "#box": randomBase64(t, 32), "#sign": base64.StdEncoding.EncodeToString(public)})); err != nil {
		t.Fatal(err)
	}
	return fluoAuthor{id: id, signer: private}
}

func (author fluoAuthor) envelope(t *testing.T, postID string, keyring []encryption.KeyRef) json.RawMessage {
	t.Helper()
	sort.Slice(keyring, func(i, j int) bool { return keyring[i].OwnerID < keyring[j].OwnerID })
	envelope := encryption.KeyringEnvelope{Version: 1, Context: "fluo:" + postID, SenderID: author.id,
		Nonce: randomBase64(t, 24), Ciphertext: randomBase64(t, 48), Keyring: keyring}
	values := []string{"kaordo-keyring-v1", envelope.Context, envelope.SenderID, envelope.Nonce, envelope.Ciphertext}
	for _, ref := range keyring {
		values = append(values, ref.OwnerID+":"+strconv.Itoa(ref.Version))
	}
	envelope.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(author.signer, []byte(strings.Join(values, "\n"))))
	raw, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func (author fluoAuthor) newPost(t *testing.T, visibility string, parent, quote *string, keyring ...encryption.KeyRef) fluo.NewPost {
	t.Helper()
	id := uuid.NewString()
	content, _, err := fluo.ValidateContent(author.envelope(t, id, keyring), id)
	if err != nil {
		t.Fatal(err)
	}
	return fluo.NewPost{ID: id, Content: content, Visibility: visibility, ParentID: parent, QuoteID: quote}
}

func postText(input fluo.NewPost) string { return encryption.KeyringTextPrefix + string(input.Content) }

func TestFluoKeyrings(t *testing.T) {
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
	ownerAccount, err := users.Upsert(ctx, "fluo-keyring-owner", "keyowner", "Key Owner")
	if err != nil {
		t.Fatal(err)
	}
	readerAccount, err := users.Upsert(ctx, "fluo-keyring-reader", "keyreader", "Key Reader")
	if err != nil {
		t.Fatal(err)
	}
	owner := registerFluoAuthor(t, ctx, pool, ownerAccount.ID)
	reader := registerFluoAuthor(t, ctx, pool, readerAccount.ID)
	store := NewFluo(pool)
	publicKey := randomBase64(t, 32)
	state, err := store.UpdateKeyring(ctx, owner.id, fluo.KeyringUpdate{Create: 1, Publish: []fluo.PublishedKey{{Version: 1, Key: publicKey}}})
	if err != nil || len(state.Versions) != 1 || !state.Versions[0].Published {
		t.Fatalf("public keyring = %+v, %v", state, err)
	}
	if _, err := store.UpdateKeyring(ctx, owner.id, fluo.KeyringUpdate{Create: 3}); !errors.Is(err, fluo.ErrKeyringStale) {
		t.Fatalf("skipped version = %v", err)
	}
	keys, err := store.Keys(ctx, reader.id, []encryption.KeyRef{{OwnerID: owner.id, Version: 1}})
	if err != nil || len(keys) != 1 || keys[0].PublicKey != publicKey || keys[0].SealedKey != "" {
		t.Fatalf("published key = %+v, %v", keys, err)
	}
	selfRef := encryption.KeyRef{OwnerID: owner.id, Version: 1}
	public, err := store.Create(ctx, owner.id, owner.newPost(t, "public", nil, nil, selfRef), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	// A reply must keep every key that protects its parent.
	if _, err := store.Create(ctx, reader.id, reader.newPost(t, "public", &public.ID, nil, encryption.KeyRef{OwnerID: reader.id, Version: 0}), "", nil); err == nil {
		t.Fatal("a reply without the parent's audience key was accepted")
	}
	if _, err := store.UpdateKeyring(ctx, reader.id, fluo.KeyringUpdate{Create: 1, Publish: []fluo.PublishedKey{{Version: 1, Key: randomBase64(t, 32)}}}); err != nil {
		t.Fatal(err)
	}
	reply := reader.newPost(t, "public", &public.ID, nil, selfRef, encryption.KeyRef{OwnerID: reader.id, Version: 1})
	if _, err := store.Create(ctx, reader.id, reply, postText(reply), nil); err != nil {
		t.Fatalf("reply with the parent's audience key = %v", err)
	}

	// Becoming private makes the published key stale until the device rotates it.
	private := fluo.VisibilityPrivate
	if _, err := store.UpdateSettings(ctx, owner.id, fluo.SettingsPatch{Privacy: &fluo.PrivacySettingsPatch{AccountVisibility: &private}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(ctx, owner.id, owner.newPost(t, "public", nil, nil, selfRef), "", nil); !errors.Is(err, fluo.ErrKeyringStale) {
		t.Fatalf("published key used by a private account = %v", err)
	}
	if _, err := store.UpdateKeyring(ctx, owner.id, fluo.KeyringUpdate{Publish: []fluo.PublishedKey{{Version: 1, Key: publicKey}}}); !errors.Is(err, fluo.ErrKeyringStale) {
		t.Fatalf("private account published a key = %v", err)
	}
	if err := store.Follow(ctx, owner.id, reader.id, true); err != nil {
		t.Fatal(err)
	}
	state, err = store.UpdateKeyring(ctx, owner.id, fluo.KeyringUpdate{Create: 2})
	if err != nil || len(state.Missing) != 1 || state.Missing[0].Recipient.ID != reader.id || len(state.Missing[0].Versions) != 1 || state.Missing[0].Versions[0] != 2 {
		t.Fatalf("rotated private keyring = %+v, %v", state, err)
	}
	sealed := randomBase64(t, 80)
	state, err = store.UpdateKeyring(ctx, owner.id, fluo.KeyringUpdate{Grants: []fluo.KeyGrant{{RecipientID: reader.id, Version: 2, SealedKey: sealed}}})
	if err != nil || len(state.Missing) != 0 {
		t.Fatalf("granted keyring = %+v, %v", state, err)
	}
	keys, err = store.Keys(ctx, reader.id, []encryption.KeyRef{{OwnerID: owner.id, Version: 2}})
	if err != nil || len(keys) != 1 || keys[0].SealedKey != sealed {
		t.Fatalf("sealed key = %+v, %v", keys, err)
	}
	privatePost := owner.newPost(t, "public", nil, nil, encryption.KeyRef{OwnerID: owner.id, Version: 2})
	if _, err := store.Create(ctx, owner.id, privatePost, postText(privatePost), nil); err != nil {
		t.Fatalf("post with the rotated key = %v", err)
	}
	if err := store.Follow(ctx, owner.id, reader.id, false); err != nil {
		t.Fatal(err)
	}
	if keys, err := store.Keys(ctx, reader.id, []encryption.KeyRef{{OwnerID: owner.id, Version: 2}}); err != nil || len(keys) != 0 {
		t.Fatalf("unfollowed account kept its grant: %+v, %v", keys, err)
	}

	// Hiding changes access only; publishing a self-only post requires a fresh audience envelope.
	hidden := owner.newPost(t, fluo.VisibilityPrivate, nil, nil, encryption.KeyRef{OwnerID: owner.id, Version: 0})
	created, err := store.Create(ctx, owner.id, hidden, postText(hidden), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetVisibility(ctx, owner.id, created.ID, fluo.VisibilityPublic, hidden.Content, postText(hidden)); err == nil {
		t.Fatal("a self-only envelope was published")
	}
	republished, _, _ := fluo.ValidateContent(owner.envelope(t, created.ID, []encryption.KeyRef{{OwnerID: owner.id, Version: 2}}), created.ID)
	if err := store.SetVisibility(ctx, owner.id, created.ID, fluo.VisibilityPublic, republished, encryption.KeyringTextPrefix+string(republished)); err != nil {
		t.Fatalf("republish = %v", err)
	}
	if err := store.SetVisibility(ctx, owner.id, created.ID, fluo.VisibilityPrivate, nil, ""); err != nil {
		t.Fatalf("hide = %v", err)
	}
}
