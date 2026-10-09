package encryption

// Defines public encryption identities and owner-scoped, signed device key transfers
import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrInvalid  = errors.New("invalid encryption request")
	ErrNotFound = errors.New("encryption identity not found")
	ErrConflict = errors.New("encryption identity conflict")
	ErrLimit    = errors.New("device limit reached")
)

type Device struct {
	ID          string    `json:"id"`
	PublicKey   string    `json:"publicKey"`
	WrappedKeys string    `json:"wrappedKeys"`
	CreatedAt   time.Time `json:"createdAt"`
}
type Identity struct {
	EncryptionPublicKey string   `json:"encryptionPublicKey"`
	SigningPublicKey    string   `json:"signingPublicKey"`
	Devices             []Device `json:"devices"`
}
type Registration struct {
	ID                  string `json:"id"`
	PublicKey           string `json:"publicKey"`
	EncryptionPublicKey string `json:"encryptionPublicKey,omitempty"`
	SigningPublicKey    string `json:"signingPublicKey,omitempty"`
	WrappedKeys         string `json:"wrappedKeys,omitempty"`
}
type Approval struct {
	WrappedKeys string `json:"wrappedKeys"`
	Signature   string `json:"signature"`
}
type DeviceRemoval struct {
	Signature string `json:"signature"`
}
type Store interface {
	PublicIdentity(context.Context, string) (PublicIdentity, error)
	Audience(context.Context, string, string, string, bool) (Audience, error)
	Identity(context.Context, string) (*Identity, error)
	Register(context.Context, string, Registration) (Identity, error)
	Approve(context.Context, string, string, Approval) (Identity, error)
	ForgetDevice(context.Context, string, string, DeviceRemoval) (Identity, error)
	Recovery(context.Context, string) (string, error)
	SetRecovery(context.Context, string, RecoveryUpdate) error
}

type RecoveryUpdate struct {
	ExpectedWrappedKeys string `json:"expectedWrappedKeys"`
	WrappedKeys         string `json:"wrappedKeys"`
	Signature           string `json:"signature"`
}

func (input RecoveryUpdate) Verify(ownerID, signingKey string) error {
	if !ValidWrappedKey(input.WrappedKeys) || (input.ExpectedWrappedKeys != "" && !ValidWrappedKey(input.ExpectedWrappedKeys)) || !ValidBase64(input.Signature, 64) || !ValidBase64(signingKey, 32) {
		return ErrInvalid
	}
	key, _ := base64.StdEncoding.DecodeString(signingKey)
	signature, _ := base64.StdEncoding.DecodeString(input.Signature)
	message := strings.Join([]string{"kaordo-recovery-v1", ownerID, input.ExpectedWrappedKeys, input.WrappedKeys}, "\n")
	if !ed25519.Verify(key, []byte(message), signature) {
		return ErrInvalid
	}
	return nil
}

func ValidID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id.String() == value
}
func ValidBase64(value string, size int) bool {
	data, err := base64.StdEncoding.Strict().DecodeString(value)
	return err == nil && len(data) == size
}
func ValidWrappedKey(value string) bool {
	data, err := base64.StdEncoding.Strict().DecodeString(value)
	return err == nil && len(data) >= 96 && len(data) <= 3072
}
func (input Registration) Validate() error {
	if !ValidID(input.ID) || !ValidBase64(input.PublicKey, 32) {
		return ErrInvalid
	}
	if input.EncryptionPublicKey == "" && input.SigningPublicKey == "" && input.WrappedKeys == "" {
		return nil
	}
	if !ValidBase64(input.EncryptionPublicKey, 32) || !ValidBase64(input.SigningPublicKey, 32) || !ValidWrappedKey(input.WrappedKeys) {
		return ErrInvalid
	}
	return nil
}
func (input Approval) Verify(ownerID string, device Device, signingKey string) error {
	if !ValidWrappedKey(input.WrappedKeys) || !ValidBase64(input.Signature, 64) || !ValidBase64(signingKey, 32) {
		return ErrInvalid
	}
	key, _ := base64.StdEncoding.DecodeString(signingKey)
	signature, _ := base64.StdEncoding.DecodeString(input.Signature)
	message := strings.Join([]string{"kaordo-device-v1", ownerID, device.ID, device.PublicKey, input.WrappedKeys}, "\n")
	if !ed25519.Verify(key, []byte(message), signature) {
		return ErrInvalid
	}
	return nil
}

func (input DeviceRemoval) Verify(ownerID string, device Device, signingKey string) error {
	if !ValidBase64(input.Signature, 64) || !ValidBase64(signingKey, 32) {
		return ErrInvalid
	}
	key, _ := base64.StdEncoding.DecodeString(signingKey)
	signature, _ := base64.StdEncoding.DecodeString(input.Signature)
	message := strings.Join([]string{"kaordo-device-forget-v1", ownerID, device.ID, device.PublicKey, device.WrappedKeys}, "\n")
	if !ed25519.Verify(key, []byte(message), signature) {
		return ErrInvalid
	}
	return nil
}

type PublicIdentity struct {
	ID                  string `json:"id"`
	EncryptionPublicKey string `json:"encryptionPublicKey"`
	SigningPublicKey    string `json:"signingPublicKey"`
}
type Audience struct {
	Public bool             `json:"public"`
	Users  []PublicIdentity `json:"users"`
}
