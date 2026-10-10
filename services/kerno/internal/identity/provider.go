// Package identity verifies OpenID Connect access tokens issued by Keycloak.
package identity

// Creates the OIDC provider and validates normalized identity claims
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

const backchannelTimeout = 10 * time.Second

var (
	errInvalidIssuerURL       = errors.New("OIDC_ISSUER must be an HTTPS URL without a query or fragment")
	errInvalidBackchannelURL  = errors.New("OIDC_BACKCHANNEL_URL must be an HTTP loopback origin")
	errNonLoopbackBackchannel = errors.New("OIDC_BACKCHANNEL_URL must use a loopback IP address")
	errUntrustedIssuerPath    = errors.New("OIDC backchannel rejected an endpoint outside the configured issuer")
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

	publicURL, err := parseIssuerURL(issuer)
	if err != nil {
		return nil, err
	}
	localURL, err := parseBackchannelURL(backchannel)
	if err != nil {
		return nil, err
	}
	client := newBackchannelClient(publicURL, localURL)
	return oidc.NewProvider(oidc.ClientContext(ctx, client), issuer)
}

func parseIssuerURL(value string) (*url.URL, error) {
	parsed, err := url.Parse(value)
	if err != nil || !isValidIssuerURL(parsed) {
		return nil, errInvalidIssuerURL
	}
	return parsed, nil
}

func isValidIssuerURL(parsed *url.URL) bool {
	return parsed != nil &&
		parsed.Scheme == "https" &&
		parsed.Host != "" &&
		parsed.User == nil &&
		parsed.RawQuery == "" &&
		parsed.Fragment == ""
}

func parseBackchannelURL(value string) (*url.URL, error) {
	parsed, err := url.Parse(value)
	if err != nil || !isValidBackchannelOrigin(parsed) {
		return nil, errInvalidBackchannelURL
	}
	if !isLoopbackAddress(parsed.Hostname()) {
		return nil, errNonLoopbackBackchannel
	}
	return parsed, nil
}

func isValidBackchannelOrigin(parsed *url.URL) bool {
	return parsed != nil &&
		parsed.Scheme == "http" &&
		parsed.Host != "" &&
		parsed.User == nil &&
		parsed.Path == "" &&
		parsed.RawQuery == "" &&
		parsed.Fragment == ""
}

func isLoopbackAddress(hostname string) bool {
	ip := net.ParseIP(hostname)
	return ip != nil && ip.IsLoopback()
}

func newBackchannelClient(issuer, local *url.URL) *http.Client {
	return &http.Client{
		Timeout: backchannelTimeout,
		Transport: issuerBackchannel{
			issuer: issuer,
			local:  local,
			base:   http.DefaultTransport,
		},
	}
}

type issuerBackchannel struct {
	issuer *url.URL
	local  *url.URL
	base   http.RoundTripper
}

func (t issuerBackchannel) RoundTrip(request *http.Request) (*http.Response, error) {
	if !t.isIssuerEndpoint(request.URL) {
		return nil, errUntrustedIssuerPath
	}
	return t.forward(request)
}

func (t issuerBackchannel) isIssuerEndpoint(endpoint *url.URL) bool {
	if endpoint.Scheme != t.issuer.Scheme || endpoint.Host != t.issuer.Host {
		return false
	}
	issuerPathPrefix := strings.TrimSuffix(t.issuer.Path, "/") + "/"
	return strings.HasPrefix(endpoint.Path, issuerPathPrefix)
}

func (t issuerBackchannel) forward(request *http.Request) (*http.Response, error) {
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
	// SessionID is the identity provider session the token belongs to
	SessionID string `json:"sid"`
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
	token, err := verifier.Verify(ctx, rawToken)
	if err != nil {
		return Claims{}, err
	}

	var claims Claims
	if err := token.Claims(&claims); err != nil {
		return Claims{}, err
	}
	return normalizeClaims(claims)
}

func normalizeClaims(claims Claims) (Claims, error) {
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
