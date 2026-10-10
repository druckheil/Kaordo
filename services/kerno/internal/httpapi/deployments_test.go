package httpapi

// Verifies that only the trusted workflow's runs start and read their own deployments
import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
)

func TestDeploymentsAcceptOnlyTheTrustedWorkflowsOwnRun(t *testing.T) {
	verify := func(_ context.Context, raw string) (identity.GitHubRun, error) {
		if raw != "trusted" {
			return identity.GitHubRun{}, identity.ErrUntrustedWorkflow
		}
		return identity.GitHubRun{ID: 42, Revision: "abc"}, nil
	}
	hosts := admin.NewHosts(map[string]admin.HostAgent{"local": hostAgentStub{}}, &adminStub{})
	router := NewRouter(nil, &fakeUsers{}, Modules{Deployments: DeploymentDependencies{Verify: verify, Hosts: hosts}}, nil)
	for _, fixture := range []struct {
		method, path, token string
		want                int
		body                string
	}{
		{http.MethodPost, "/v1/deployments", "", http.StatusUnauthorized, ""},
		{http.MethodPost, "/v1/deployments", "forged", http.StatusUnauthorized, ""},
		{http.MethodPost, "/v1/deployments", "trusted", http.StatusOK, `"run":42,"state":"waiting"`},
		{http.MethodGet, "/v1/deployments/42", "trusted", http.StatusOK, `"state":"deploying"`},
		{http.MethodGet, "/v1/deployments/41", "trusted", http.StatusForbidden, ""},
	} {
		request := httptest.NewRequest(fixture.method, fixture.path, nil)
		if fixture.token != "" {
			request.Header.Set("Authorization", "Bearer "+fixture.token)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if recorder.Code != fixture.want || !strings.Contains(recorder.Body.String(), fixture.body) {
			t.Errorf("%s %s with %q = %d %s", fixture.method, fixture.path, fixture.token, recorder.Code, recorder.Body)
		}
	}
}

func TestDeploymentsAreAbsentWithoutATrustedWorkflow(t *testing.T) {
	hosts := admin.NewHosts(map[string]admin.HostAgent{"local": hostAgentStub{err: errors.New("unused")}}, &adminStub{})
	router := NewRouter(nil, &fakeUsers{}, Modules{Deployments: DeploymentDependencies{Hosts: hosts}}, nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/deployments", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("deployments without a workflow = %d", recorder.Code)
	}
}
