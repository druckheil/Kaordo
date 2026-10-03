package identity

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// NewProvider loads the self-hosted OIDC provider metadata.
func NewProvider(ctx context.Context, issuer string) (*oidc.Provider, error) {
	return oidc.NewProvider(ctx, issuer)
}

// NewProviderWithBackchannel fetches discovery and signing keys from a local
// Keycloak listener while retaining the public issuer for token validation.
// Only the issuer's own endpoints can use the backchannel.
func NewProviderWithBackchannel(ctx context.Context, issuer, backchannel string) (*oidc.Provider, error) {
	if backchannel == "" {
		return NewProvider(ctx, issuer)
	}
	publicURL, err := url.Parse(issuer)
	if err != nil || publicURL.Scheme != "https" || publicURL.Host == "" || publicURL.User != nil || publicURL.RawQuery != "" || publicURL.Fragment != "" {
		return nil, errors.New("OIDC_ISSUER must be an HTTPS URL without a query or fragment")
	}
	localURL, err := url.Parse(backchannel)
	if err != nil || localURL.Scheme != "http" || localURL.Host == "" || localURL.User != nil || localURL.Path != "" || localURL.RawQuery != "" || localURL.Fragment != "" {
		return nil, errors.New("OIDC_BACKCHANNEL_URL must be an HTTP loopback origin")
	}
	ip := net.ParseIP(localURL.Hostname())
	if ip == nil || !ip.IsLoopback() {
		return nil, errors.New("OIDC_BACKCHANNEL_URL must use a loopback IP address")
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: issuerBackchannel{
			issuer: publicURL,
			local:  localURL,
			base:   http.DefaultTransport,
		},
	}
	return oidc.NewProvider(oidc.ClientContext(ctx, client), issuer)
}

type issuerBackchannel struct {
	issuer *url.URL
	local  *url.URL
	base   http.RoundTripper
}

func (t issuerBackchannel) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Scheme != t.issuer.Scheme || request.URL.Host != t.issuer.Host ||
		!strings.HasPrefix(request.URL.Path, strings.TrimSuffix(t.issuer.Path, "/")+"/") {
		return nil, errors.New("OIDC backchannel rejected an endpoint outside the configured issuer")
	}
	forwarded := request.Clone(request.Context())
	forwarded.URL.Scheme = t.local.Scheme
	forwarded.URL.Host = t.local.Host
	forwarded.Host = t.local.Host
	return t.base.RoundTrip(forwarded)
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
