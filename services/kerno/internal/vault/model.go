// Package vault defines owner-only opaque records with revision-checked writes.
package vault

// Defines bounded owner-only ciphertext transactions with optimistic concurrency
import (
	"context"

	"github.com/druckheil/Kaordo/services/kerno/internal/encryption"
)

type Record struct {
	Tag      string `json:"tag"`
	Revision int64  `json:"revision"`
	encryption.PrivateEnvelope
}
type Write struct {
	Tag      string `json:"tag"`
	Revision int64  `json:"revision"`
	encryption.PrivateEnvelope
}
type Delete struct {
	Tag      string `json:"tag"`
	Revision int64  `json:"revision"`
}
type Transaction struct {
	Writes  []Write  `json:"writes"`
	Deletes []Delete `json:"deletes"`
}
type Store interface {
	Read(context.Context, string, []string) ([]Record, error)
	Commit(context.Context, string, Transaction) ([]Record, error)
}

func (input Transaction) Validate() error {
	if len(input.Writes)+len(input.Deletes) == 0 || len(input.Writes)+len(input.Deletes) > 502 {
		return encryption.ErrInvalid
	}
	seen := map[string]bool{}
	for _, write := range input.Writes {
		if !encryption.ValidIndex(write.Tag) || seen[write.Tag] {
			return encryption.ErrInvalid
		}
		seen[write.Tag] = true
		if write.Revision < 0 {
			return encryption.ErrInvalid
		}
		if err := write.Validate(2097152); err != nil {
			return err
		}
	}
	for _, item := range input.Deletes {
		if !encryption.ValidIndex(item.Tag) || item.Revision < 1 || seen[item.Tag] {
			return encryption.ErrInvalid
		}
		seen[item.Tag] = true
	}
	return nil
}
