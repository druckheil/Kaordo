package postgres

// Stores author audience keys and checks that encrypted posts reference the audience they will be served to
import (
	"context"
	"encoding/json"
	"errors"
	"math"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
)

const maxKeyRequests = 128

// lockFluoKeyring serializes key rotation and privacy changes with writes that cite the current key
func lockFluoKeyring(ctx context.Context, tx pgx.Tx, ownerID string, exclusive bool) error {
	lock := "FOR SHARE"
	if exclusive {
		lock = "FOR NO KEY UPDATE"
	}
	var id string
	return jetQueryRow(ctx, tx, jetpg.RawStatement(`SELECT id::text FROM users WHERE id = #owner::uuid `+lock,
		jetpg.RawArgs{"#owner": ownerID})).Scan(&id)
}

func fluoAccountPrivate(ctx context.Context, executor jetExecutor, ownerID string) (bool, error) {
	var private bool
	err := jetQueryRow(ctx, executor, jetpg.RawStatement(`SELECT EXISTS (
		SELECT 1 FROM fluo_settings WHERE user_id = #owner::uuid AND account_visibility = 'private')`,
		jetpg.RawArgs{"#owner": ownerID})).Scan(&private)
	return private, err
}

func currentFluoKey(ctx context.Context, executor jetExecutor, ownerID string) (int, bool, error) {
	var version int
	var published bool
	err := jetQueryRow(ctx, executor, jetpg.RawStatement(`SELECT version, public_key IS NOT NULL FROM fluo_keyrings
		WHERE owner_id = #owner::uuid ORDER BY version DESC LIMIT 1`, jetpg.RawArgs{"#owner": ownerID})).Scan(&version, &published)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	return version, published, err
}

func (s *Fluo) KeyringState(ctx context.Context, ownerID string) (fluo.KeyringState, error) {
	return fluoKeyringState(ctx, s.pool, ownerID)
}

func fluoKeyringState(ctx context.Context, executor jetExecutor, ownerID string) (fluo.KeyringState, error) {
	state := fluo.KeyringState{AccountVisibility: fluo.VisibilityPublic, Versions: []fluo.KeyringVersion{}, Missing: []fluo.KeyringGrantRequest{}}
	private, err := fluoAccountPrivate(ctx, executor, ownerID)
	if err != nil {
		return state, err
	}
	if private {
		state.AccountVisibility = fluo.VisibilityPrivate
	}
	args := jetpg.RawArgs{"#owner": ownerID}
	rows, err := jetQuery(ctx, executor, jetpg.RawStatement(`SELECT version, public_key IS NOT NULL FROM fluo_keyrings
		WHERE owner_id = #owner::uuid ORDER BY version`, args))
	if err != nil {
		return state, err
	}
	for rows.Next() {
		var item fluo.KeyringVersion
		if err := rows.Scan(&item.Version, &item.Published); err != nil {
			rows.Close()
			return state, err
		}
		state.Versions = append(state.Versions, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil || !private {
		return state, err
	}
	// Followed accounts may create their device identity after being followed, so grants are reconciled.
	rows, err = jetQuery(ctx, executor, jetpg.RawStatement(`SELECT a.user_id::text, a.encryption_public_key, a.signing_public_key,
			array_agg(k.version ORDER BY k.version)
		FROM fluo_follows f
		JOIN crypto_accounts a ON a.user_id = f.followed_id
		JOIN fluo_keyrings k ON k.owner_id = f.follower_id AND k.public_key IS NULL
		WHERE f.follower_id = #owner::uuid AND NOT EXISTS (
			SELECT 1 FROM fluo_keyring_grants g
			WHERE g.owner_id = k.owner_id AND g.version = k.version AND g.recipient_id = f.followed_id)
		GROUP BY a.user_id, a.encryption_public_key, a.signing_public_key
		ORDER BY a.user_id LIMIT 256`, args))
	if err != nil {
		return state, err
	}
	defer rows.Close()
	for rows.Next() {
		var item fluo.KeyringGrantRequest
		var versions []int32
		if err := rows.Scan(&item.Recipient.ID, &item.Recipient.EncryptionPublicKey, &item.Recipient.SigningPublicKey, &versions); err != nil {
			return state, err
		}
		for _, version := range versions {
			item.Versions = append(item.Versions, int(version))
		}
		state.Missing = append(state.Missing, item)
	}
	return state, rows.Err()
}

func (s *Fluo) UpdateKeyring(ctx context.Context, ownerID string, update fluo.KeyringUpdate) (fluo.KeyringState, error) {
	if err := update.Validate(); err != nil {
		return fluo.KeyringState{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fluo.KeyringState{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockFluoKeyring(ctx, tx, ownerID, true); err != nil {
		return fluo.KeyringState{}, err
	}
	if err := createFluoKeyVersion(ctx, tx, ownerID, update.Create); err != nil {
		return fluo.KeyringState{}, err
	}
	if err := publishFluoKeys(ctx, tx, ownerID, update.Publish); err != nil {
		return fluo.KeyringState{}, err
	}
	if err := grantFluoKeys(ctx, tx, ownerID, update.Grants); err != nil {
		return fluo.KeyringState{}, err
	}
	state, err := fluoKeyringState(ctx, tx, ownerID)
	if err != nil {
		return state, err
	}
	return state, tx.Commit(ctx)
}

// createFluoKeyVersion records the next version; 0 means no new version was requested
func createFluoKeyVersion(ctx context.Context, tx pgx.Tx, ownerID string, version int) error {
	if version == 0 {
		return nil
	}
	current, _, err := currentFluoKey(ctx, tx, ownerID)
	if err != nil {
		return err
	}
	if version != current+1 {
		return fluo.ErrKeyringStale
	}
	_, err = jetExec(ctx, tx, jetpg.RawStatement(`INSERT INTO fluo_keyrings (owner_id, version) VALUES (#owner::uuid, #version)`,
		jetpg.RawArgs{"#owner": ownerID, "#version": version}))
	return err
}

// publishFluoKeys exposes key versions, which only a public account may do
func publishFluoKeys(ctx context.Context, tx pgx.Tx, ownerID string, keys []fluo.PublishedKey) error {
	if len(keys) == 0 {
		return nil
	}
	private, err := fluoAccountPrivate(ctx, tx, ownerID)
	if err != nil {
		return err
	}
	if private {
		return fluo.ErrKeyringStale
	}
	for _, item := range keys {
		changed, err := jetExec(ctx, tx, jetpg.RawStatement(`UPDATE fluo_keyrings SET public_key = #key
			WHERE owner_id = #owner::uuid AND version = #version AND (public_key IS NULL OR public_key = #key)`,
			jetpg.RawArgs{"#owner": ownerID, "#version": item.Version, "#key": item.Key}))
		if err != nil {
			return err
		}
		if changed.RowsAffected() == 0 {
			return fluo.ErrKeyringStale
		}
	}
	return nil
}

// grantFluoKeys stores sealed copies; accounts unfollowed meanwhile are skipped until the next reconciliation
func grantFluoKeys(ctx context.Context, tx pgx.Tx, ownerID string, grants []fluo.KeyGrant) error {
	for _, item := range grants {
		if _, err := jetExec(ctx, tx, jetpg.RawStatement(`INSERT INTO fluo_keyring_grants (owner_id, version, recipient_id, sealed_key)
			SELECT #owner::uuid, #version, #recipient::uuid, #key
			WHERE EXISTS (SELECT 1 FROM fluo_follows WHERE follower_id = #owner::uuid AND followed_id = #recipient::uuid)
			  AND EXISTS (SELECT 1 FROM fluo_keyrings WHERE owner_id = #owner::uuid AND version = #version)
			ON CONFLICT DO NOTHING`,
			jetpg.RawArgs{"#owner": ownerID, "#version": item.Version, "#recipient": item.RecipientID, "#key": item.SealedKey})); err != nil {
			return err
		}
	}
	return nil
}

func (s *Fluo) Keys(ctx context.Context, viewerID string, refs []encryption.KeyRef) ([]fluo.KeyMaterial, error) {
	if len(refs) == 0 || len(refs) > maxKeyRequests {
		return nil, fluo.ErrInvalidKeyring
	}
	owners := make([]string, len(refs))
	versions := make([]int32, len(refs))
	for index, ref := range refs {
		if !fluo.ValidID(ref.OwnerID) || ref.Version < 1 || ref.Version > math.MaxInt32 {
			return nil, fluo.ErrInvalidKeyring
		}
		owners[index], versions[index] = ref.OwnerID, int32(ref.Version)
	}
	rows, err := jetQuery(ctx, s.pool, jetpg.RawStatement(`SELECT k.owner_id::text, k.version, COALESCE(k.public_key, ''), COALESCE(g.sealed_key, '')
		FROM unnest(#owners::uuid[], #versions::int[]) AS wanted(owner_id, version)
		JOIN fluo_keyrings k ON k.owner_id = wanted.owner_id AND k.version = wanted.version
		LEFT JOIN fluo_keyring_grants g ON g.owner_id = k.owner_id AND g.version = k.version AND g.recipient_id = #viewer::uuid
		WHERE k.public_key IS NOT NULL OR g.sealed_key IS NOT NULL`,
		jetpg.RawArgs{"#owners": owners, "#versions": versions, "#viewer": viewerID}))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]fluo.KeyMaterial, 0, len(refs))
	for rows.Next() {
		var item fluo.KeyMaterial
		if err := rows.Scan(&item.OwnerID, &item.Version, &item.PublicKey, &item.SealedKey); err != nil {
			return nil, err
		}
		if item.PublicKey != "" {
			item.SealedKey = ""
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// verifyFluoPostKeyring requires the author's current audience key plus every other key protecting the parent
func verifyFluoPostKeyring(ctx context.Context, tx pgx.Tx, actorID, visibility string, parentID *string, content json.RawMessage) error {
	envelope, err := signedFluoEnvelope(ctx, tx, actorID, content)
	if err != nil {
		return err
	}
	own, _ := envelope.Ref(actorID)
	if visibility == fluo.VisibilityPrivate {
		if own.Version != 0 || len(envelope.Keyring) != 1 {
			return encryption.ErrInvalid
		}
		return nil
	}
	if err := requireCurrentFluoKey(ctx, tx, actorID, own.Version); err != nil {
		return err
	}
	inherited, err := inheritedFluoKeys(ctx, tx, actorID, parentID)
	if err != nil {
		return err
	}
	if len(envelope.Keyring) != len(inherited)+1 {
		return encryption.ErrInvalid
	}
	for _, ref := range envelope.Keyring {
		if version, ok := inherited[ref.OwnerID]; ref.OwnerID != actorID && (!ok || version != ref.Version) {
			return encryption.ErrInvalid
		}
	}
	return nil
}

func signedFluoEnvelope(ctx context.Context, tx pgx.Tx, actorID string, content json.RawMessage) (encryption.KeyringEnvelope, error) {
	envelope, err := encryption.ParseKeyring(content)
	if err != nil || envelope.SenderID != actorID {
		return envelope, encryption.ErrInvalid
	}
	identity, err := publicEncryptionIdentity(ctx, tx, actorID)
	if err != nil {
		return envelope, err
	}
	return envelope, envelope.Verify(identity.SigningPublicKey)
}

// requireCurrentFluoKey rejects stale versions and a published key used after the account became private
func requireCurrentFluoKey(ctx context.Context, tx pgx.Tx, actorID string, version int) error {
	current, published, err := currentFluoKey(ctx, tx, actorID)
	if err != nil {
		return err
	}
	private, err := fluoAccountPrivate(ctx, tx, actorID)
	if err != nil {
		return err
	}
	if current == 0 || version != current || private && published {
		return fluo.ErrKeyringStale
	}
	return nil
}

// inheritedFluoKeys returns the parent's audience keys other than the replying author's own
func inheritedFluoKeys(ctx context.Context, tx pgx.Tx, actorID string, parentID *string) (map[string]int, error) {
	inherited := map[string]int{}
	if parentID == nil {
		return inherited, nil
	}
	var raw []byte
	if err := jetQueryRow(ctx, tx, jetpg.RawStatement(`SELECT content FROM fluo_posts WHERE id = #parent::uuid`,
		jetpg.RawArgs{"#parent": *parentID})).Scan(&raw); err != nil {
		return nil, err
	}
	parent, err := encryption.ParseKeyring(raw)
	if err != nil {
		return nil, err
	}
	for _, ref := range parent.Keyring {
		if ref.OwnerID != actorID {
			inherited[ref.OwnerID] = ref.Version
		}
	}
	return inherited, nil
}
