// Package fluo defines Fluo posts, profiles, notifications, settings and audience keys.
package fluo

// Defines author audience keys: published for public accounts, sealed to followed accounts otherwise
import (
	"encoding/json"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
)

var (
	ErrKeyringStale     = errors.New("the audience key changed; refresh it and try again")
	ErrBranchHasReplies = errors.New("a private post with replies cannot become public")
)

const maxKeyringChanges = 512

type KeyringVersion struct {
	Version   int  `json:"version"`
	Published bool `json:"published"`
}

// KeyringGrantRequest lists versions a followed account still needs from the owner's device
type KeyringGrantRequest struct {
	Recipient encryption.PublicIdentity `json:"recipient"`
	Versions  []int                     `json:"versions"`
}

type KeyringState struct {
	AccountVisibility string                `json:"accountVisibility"`
	Versions          []KeyringVersion      `json:"versions"`
	Missing           []KeyringGrantRequest `json:"missing"`
}

type PublishedKey struct {
	Version int    `json:"version"`
	Key     string `json:"key"`
}

type KeyGrant struct {
	RecipientID string `json:"recipientId"`
	Version     int    `json:"version"`
	SealedKey   string `json:"sealedKey"`
}

type KeyringUpdate struct {
	Create  int            `json:"create"`
	Publish []PublishedKey `json:"publish"`
	Grants  []KeyGrant     `json:"grants"`
}

// KeyMaterial returns either a published key or the viewer's sealed copy
type KeyMaterial struct {
	OwnerID   string `json:"ownerId"`
	Version   int    `json:"version"`
	PublicKey string `json:"publicKey,omitempty"`
	SealedKey string `json:"sealedKey,omitempty"`
}

type VisibilityChange struct {
	Visibility string          `json:"visibility"`
	Content    json.RawMessage `json:"content,omitempty"`
}

func (u KeyringUpdate) Validate() error {
	if u.Create < 0 || len(u.Publish)+len(u.Grants) > maxKeyringChanges {
		return ErrInvalidKeyring
	}
	for _, item := range u.Publish {
		if item.Version < 1 || !encryption.ValidBase64(item.Key, 32) {
			return ErrInvalidKeyring
		}
	}
	for _, item := range u.Grants {
		if item.Version < 1 || !ValidID(item.RecipientID) || !encryption.ValidBase64(item.SealedKey, 80) {
			return ErrInvalidKeyring
		}
	}
	return nil
}

var ErrInvalidKeyring = errors.New("invalid audience key update")

// ValidateContent accepts only device-encrypted post envelopes and returns their stored forms
func ValidateContent(raw json.RawMessage, postID string) (json.RawMessage, string, error) {
	envelope, err := encryption.ParseKeyring(raw)
	if err != nil || envelope.Context != "fluo:"+postID {
		return nil, "", encryption.ErrInvalid
	}
	canonical, err := json.Marshal(envelope)
	return canonical, encryption.KeyringTextPrefix + string(canonical), err
}
