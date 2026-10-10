package api

// Starts the production deployment of a GitHub Actions run and reports its state
import (
	"net/http"
	"strconv"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/deployment"
)

func handleDeployments(mux *http.ServeMux, deployments deployment.Deployments) {
	mux.HandleFunc("POST /deployments", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Run int64 `json:"run"`
		}
		if !decode(w, r, &request) {
			return
		}
		if request.Run < 1 {
			writeError(w, http.StatusBadRequest, "A GitHub Actions run is required.")
			return
		}
		record, err := deployments.Start(r.Context(), request.Run)
		respond(w, record, err)
	})
	mux.HandleFunc("GET /deployments/{run}", func(w http.ResponseWriter, r *http.Request) {
		run, err := strconv.ParseInt(r.PathValue("run"), 10, 64)
		if err != nil || run < 1 {
			writeError(w, http.StatusBadRequest, "A GitHub Actions run is required.")
			return
		}
		record, err := deployments.Status(r.Context(), run)
		respond(w, record, err)
	})
}
