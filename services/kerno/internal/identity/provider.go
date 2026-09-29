package identity

import (
	"context"
	"errors"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
)

// NewProvider loads the self-hosted OIDC provider metadata.
func NewProvider(ctx context.Context, issuer string) (*oidc.Provider, error) {
	return oidc.NewProvider(ctx, issuer)
}

type Claims struct {
	Subject  string `json:"sub"`
	Username string `json:"preferred_username"`
	Name     string `json:"name"`
}

var (
	ErrMissingSubject  = errors.New("identity token has no subject")
	ErrMissingUsername = errors.New("identity token has no username")
)

// FailureCode returns a small, safe reason for a rejected token. Verifier
// errors can contain claim values, so they must not be sent to the browser.
func FailureCode(err error) string {
	if err == nil {
		return ""
	}
	var expired *oidc.TokenExpiredError
	switch {
	case errors.As(err, &expired):
		return "expired_token"
	case errors.Is(err, ErrMissingSubject):
		return "missing_subject"
	case errors.Is(err, ErrMissingUsername):
		return "missing_username"
	case strings.Contains(err.Error(), "oidc: expected audience"):
		return "invalid_audience"
	case strings.Contains(err.Error(), "oidc: id token issued by a different provider"):
		return "invalid_issuer"
	default:
		return "invalid_token"
	}
}

func Verify(ctx context.Context, verifier *oidc.IDTokenVerifier, rawToken string) (Claims, error) {
	var claims Claims
	token, err := verifier.Verify(ctx, rawToken)
	if err != nil {
		return claims, err
	}
	if err := token.Claims(&claims); err != nil {
		return claims, err
	}
	claims.Subject = strings.TrimSpace(claims.Subject)
	claims.Username = strings.TrimSpace(claims.Username)
	claims.Name = strings.TrimSpace(claims.Name)
	if claims.Subject == "" {
		return Claims{}, ErrMissingSubject
	}
	if claims.Username == "" {
		return Claims{}, ErrMissingUsername
	}
	if claims.Name == "" {
		claims.Name = claims.Username
	}
	return claims, nil
}
