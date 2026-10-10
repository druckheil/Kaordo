package postgres

// Stores public account identities and signed, sealed device approvals without private keys
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Encryption struct{ pool *pgxpool.Pool }

func NewEncryption(pool *pgxpool.Pool) *Encryption { return &Encryption{pool: pool} }

func encryptionIdentity(ctx context.Context, executor jetExecutor, actorID string) (*encryption.Identity, error) {
	a := table.CryptoAccounts
	identity := &encryption.Identity{Devices: make([]encryption.Device, 0)}
	err := jetQueryRow(ctx, executor, a.SELECT(a.EncryptionPublicKey, a.SigningPublicKey).WHERE(a.UserID.EQ(jetUUID(actorID)))).
		Scan(&identity.EncryptionPublicKey, &identity.SigningPublicKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d := table.CryptoDevices
	rows, err := jetQuery(ctx, executor, d.SELECT(d.ID, d.PublicKey, d.WrappedKeys, d.CreatedAt, d.SessionID, d.UnlockedWith, d.UnlockedAt).
		WHERE(d.UserID.EQ(jetUUID(actorID))).ORDER_BY(d.CreatedAt.ASC(), d.ID.ASC()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var device encryption.Device
		if err := rows.Scan(&device.ID, &device.PublicKey, &device.WrappedKeys, &device.CreatedAt,
			&device.SessionID, &device.UnlockedWith, &device.UnlockedAt); err != nil {
			return nil, err
		}
		identity.Devices = append(identity.Devices, device)
	}
	return identity, rows.Err()
}
func (s *Encryption) Identity(ctx context.Context, actorID string) (*encryption.Identity, error) {
	return encryptionIdentity(ctx, s.pool, actorID)
}

func lockEncryptionOwner(ctx context.Context, tx pgx.Tx, actorID string) error {
	u := table.Users
	var id string
	err := jetQueryRow(ctx, tx, u.SELECT(u.ID).WHERE(u.ID.EQ(jetUUID(actorID))).FOR(jetpg.NO_KEY_UPDATE())).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return encryption.ErrNotFound
	}
	return err
}

func (s *Encryption) Register(ctx context.Context, actorID, sessionID string, input encryption.Registration) (encryption.Identity, error) {
	if err := input.Validate(); err != nil {
		return encryption.Identity{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return encryption.Identity{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockEncryptionOwner(ctx, tx, actorID); err != nil {
		return encryption.Identity{}, err
	}
	current, err := encryptionIdentity(ctx, tx, actorID)
	if err != nil {
		return encryption.Identity{}, err
	}
	wrapped, unlocked := "", ""
	unlockedAt := jetpg.NULL
	if current == nil {
		if input.WrappedKeys == "" {
			return encryption.Identity{}, encryption.ErrInvalid
		}
		a := table.CryptoAccounts
		if _, err := jetExec(ctx, tx, a.INSERT(a.UserID, a.EncryptionPublicKey, a.SigningPublicKey).
			VALUES(jetUUID(actorID), jetpg.String(input.EncryptionPublicKey), jetpg.String(input.SigningPublicKey))); err != nil {
			return encryption.Identity{}, err
		}
		wrapped, unlocked, unlockedAt = input.WrappedKeys, encryption.UnlockedByAccount, jetpg.NOW()
	} else {
		for _, device := range current.Devices {
			if device.ID == input.ID {
				if device.PublicKey != input.PublicKey {
					return encryption.Identity{}, encryption.ErrConflict
				}
				return *current, tx.Commit(ctx)
			}
		}
		if len(current.Devices) >= 20 {
			return encryption.Identity{}, encryption.ErrLimit
		}
	}
	d := table.CryptoDevices
	if _, err := jetExec(ctx, tx, d.INSERT(d.UserID, d.ID, d.PublicKey, d.WrappedKeys, d.SessionID, d.UnlockedWith, d.UnlockedAt).
		VALUES(jetUUID(actorID), jetUUID(input.ID), jetpg.String(input.PublicKey), jetpg.String(wrapped),
			jetpg.String(sessionID), jetpg.String(unlocked), unlockedAt)); err != nil {
		return encryption.Identity{}, err
	}
	identity, err := encryptionIdentity(ctx, tx, actorID)
	if err != nil {
		return encryption.Identity{}, err
	}
	return *identity, tx.Commit(ctx)
}

// Approve stores a signed key transfer. Only the device itself can complete one in its own session,
// using the recovery key; any other session approving it is an already approved device.
func (s *Encryption) Approve(ctx context.Context, actorID, sessionID, deviceID string, input encryption.Approval) (encryption.Identity, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return encryption.Identity{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockEncryptionOwner(ctx, tx, actorID); err != nil {
		return encryption.Identity{}, err
	}
	identity, err := encryptionIdentity(ctx, tx, actorID)
	if err != nil {
		return encryption.Identity{}, err
	}
	if identity == nil {
		return encryption.Identity{}, encryption.ErrNotFound
	}
	for _, device := range identity.Devices {
		if device.ID != deviceID {
			continue
		}
		if err := input.Verify(actorID, device, identity.SigningPublicKey); err != nil {
			return encryption.Identity{}, err
		}
		if device.WrappedKeys != "" {
			return *identity, tx.Commit(ctx)
		}
		unlocked := encryption.UnlockedByDevice
		if sessionID != "" && device.SessionID == sessionID {
			unlocked = encryption.UnlockedByRecovery
		}
		d := table.CryptoDevices
		if _, err := jetExec(ctx, tx, d.UPDATE(d.WrappedKeys, d.UnlockedWith, d.UnlockedAt).
			SET(jetpg.String(input.WrappedKeys), jetpg.String(unlocked), jetpg.NOW()).
			WHERE(jetpg.AND(d.UserID.EQ(jetUUID(actorID)), d.ID.EQ(jetUUID(deviceID))))); err != nil {
			return encryption.Identity{}, err
		}
		result, err := encryptionIdentity(ctx, tx, actorID)
		if err != nil {
			return encryption.Identity{}, err
		}
		return *result, tx.Commit(ctx)
	}
	return encryption.Identity{}, encryption.ErrNotFound
}

// UseDevice records that sessionID now uses the account's device deviceID.
func (s *Encryption) UseDevice(ctx context.Context, actorID, sessionID, deviceID string) error {
	d := table.CryptoDevices
	result, err := jetExec(ctx, s.pool, d.UPDATE(d.SessionID).SET(jetpg.String(sessionID)).
		WHERE(jetpg.AND(d.UserID.EQ(jetUUID(actorID)), d.ID.EQ(jetUUID(deviceID)))))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return encryption.ErrNotFound
	}
	return nil
}

var _ encryption.Store = (*Encryption)(nil)

func (s *Encryption) ForgetDevice(ctx context.Context, actorID, deviceID string, input encryption.DeviceRemoval) (encryption.Identity, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return encryption.Identity{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockEncryptionOwner(ctx, tx, actorID); err != nil {
		return encryption.Identity{}, err
	}
	identity, err := encryptionIdentity(ctx, tx, actorID)
	if err != nil {
		return encryption.Identity{}, err
	}
	if identity == nil {
		return encryption.Identity{}, encryption.ErrNotFound
	}
	for _, device := range identity.Devices {
		if device.ID != deviceID {
			continue
		}
		if err := input.Verify(actorID, device, identity.SigningPublicKey); err != nil {
			return encryption.Identity{}, err
		}
		d := table.CryptoDevices
		if _, err := jetExec(ctx, tx, d.DELETE().WHERE(jetpg.AND(d.UserID.EQ(jetUUID(actorID)), d.ID.EQ(jetUUID(deviceID))))); err != nil {
			return encryption.Identity{}, err
		}
		result, err := encryptionIdentity(ctx, tx, actorID)
		if err != nil {
			return encryption.Identity{}, err
		}
		return *result, tx.Commit(ctx)
	}
	return encryption.Identity{}, encryption.ErrNotFound
}
