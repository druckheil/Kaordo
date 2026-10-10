package identity

// Verifies the OIDC tokens GitHub Actions mints for a workflow run that asks to be deployed
import (
	"context"
	"errors"
	"strconv"

	"github.com/coreos/go-oidc/v3/oidc"
)

const githubIssuer = "https://token.actions.githubusercontent.com"

var ErrUntrustedWorkflow = errors.New("the token was not minted by a push run of the trusted workflow")

// GitHubRun is the workflow run an Actions token speaks for.
type GitHubRun struct {
	ID       int64
	Revision string
}

type GitHubVerifyFunc func(context.Context, string) (GitHubRun, error)

// NewGitHubVerifier accepts tokens minted for audience by push runs of workflow, written as
// GitHub's workflow_ref: "owner/repository/.github/workflows/file.yml@refs/heads/branch".
// Signing keys are fetched on first use, so Kerno starts while GitHub is unreachable.
func NewGitHubVerifier(ctx context.Context, audience, workflow string) GitHubVerifyFunc {
	keys := oidc.NewRemoteKeySet(ctx, githubIssuer+"/.well-known/jwks")
	return newGitHubVerifier(githubIssuer, keys, audience, workflow)
}

func newGitHubVerifier(issuer string, keys oidc.KeySet, audience, workflow string) GitHubVerifyFunc {
	verifier := oidc.NewVerifier(issuer, keys, &oidc.Config{ClientID: audience})
	return func(ctx context.Context, raw string) (GitHubRun, error) {
		token, err := verifier.Verify(ctx, raw)
		if err != nil {
			return GitHubRun{}, err
		}
		var claims struct {
			WorkflowRef string `json:"workflow_ref"`
			Event       string `json:"event_name"`
			RunID       string `json:"run_id"`
			SHA         string `json:"sha"`
		}
		if err := token.Claims(&claims); err != nil {
			return GitHubRun{}, err
		}
		run, err := strconv.ParseInt(claims.RunID, 10, 64)
		if err != nil || run < 1 || claims.WorkflowRef != workflow || claims.Event != "push" {
			return GitHubRun{}, ErrUntrustedWorkflow
		}
		return GitHubRun{ID: run, Revision: claims.SHA}, nil
	}
}
