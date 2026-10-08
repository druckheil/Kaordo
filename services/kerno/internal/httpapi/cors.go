package httpapi

// Applies configured browser origins before dispatching requests
import (
	"net/http"
	"strings"
)

func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	origins := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			origins[trimmed] = struct{}{}
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Add("Vary", "Origin")
			if !setAllowedOrigin(w, r, origins) {
				return
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func setAllowedOrigin(w http.ResponseWriter, r *http.Request, allowed map[string]struct{}) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	if _, ok := allowed[origin]; !ok {
		writeError(w, http.StatusForbidden, "Origin is not allowed.")
		return false
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	return true
}
