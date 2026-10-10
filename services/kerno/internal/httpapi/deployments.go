package httpapi

// Relays the trusted GitHub workflow's request to install its release on the production host
import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
	"github.com/go-chi/chi/v5"
)

// productionHost is the host Kerno itself runs on, which deployments install releases onto
const productionHost = "local"

type DeploymentDependencies struct {
	Verify identity.GitHubVerifyFunc
	Hosts  *admin.Hosts
}

type deploymentsHandler DeploymentDependencies

func mountDeployments(router chi.Router, deps DeploymentDependencies) {
	h := deploymentsHandler(deps)
	router.Post("/v1/deployments", h.start)
	router.Get("/v1/deployments/{run}", h.status)
}

// run authenticates the workflow run asking; only the trusted workflow's push runs are accepted
func (h deploymentsHandler) run(w http.ResponseWriter, r *http.Request) (identity.GitHubRun, bool) {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		writeError(w, http.StatusUnauthorized, "A GitHub Actions token is required.")
		return identity.GitHubRun{}, false
	}
	run, err := h.Verify(r.Context(), parts[1])
	if err != nil {
		slog.Warn("deployment request rejected", "reason", identity.FailureCode(err))
		writeError(w, http.StatusUnauthorized, "This token cannot request deployments.")
		return identity.GitHubRun{}, false
	}
	return run, true
}

func (h deploymentsHandler) start(w http.ResponseWriter, r *http.Request) {
	run, ok := h.run(w, r)
	if !ok {
		return
	}
	slog.Info("deployment requested", "run", run.ID, "revision", run.Revision)
	result, err := h.Hosts.Deploy(r.Context(), productionHost, admin.DeploymentRequest{Run: run.ID, Attempt: run.Attempt, Revision: run.Revision})
	writeHostResult(w, result, err)
}

func (h deploymentsHandler) status(w http.ResponseWriter, r *http.Request) {
	run, ok := h.run(w, r)
	if !ok {
		return
	}
	if chi.URLParam(r, "run") != strconv.FormatInt(run.ID, 10) {
		writeError(w, http.StatusForbidden, "A run can read only its own deployment.")
		return
	}
	result, err := h.Hosts.Deployment(r.Context(), productionHost, run.ID)
	writeHostResult(w, result, err)
}
