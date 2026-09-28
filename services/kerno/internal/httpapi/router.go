package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// NewRouter is the future boundary for Kaordo HTTP API routes.
func NewRouter() http.Handler {
	return chi.NewRouter()
}
