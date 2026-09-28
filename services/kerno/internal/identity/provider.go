package identity

import (
	"context"

	"github.com/coreos/go-oidc/v3/oidc"
)

// NewProvider loads the self-hosted OIDC provider metadata.
func NewProvider(ctx context.Context, issuer string) (*oidc.Provider, error) {
	return oidc.NewProvider(ctx, issuer)
}
