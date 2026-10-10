package httpapi

// Serves the static German starter catalog; dictionaries are encrypted private records
import (
	"errors"
	"net/http"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/lingvo"
	"github.com/go-chi/chi/v5"
)

func mountLingvo(router chi.Router, verify VerifyFunc, users account.Store) {
	router.Get("/v1/lingvo/catalog", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := authenticatedActor(w, r, verify, users, "Start a Kaordo account session before using Lingvo."); !ok {
			return
		}
		items, err := lingvo.Catalog(r.URL.Query().Get("nativeLanguage"))
		if errors.Is(err, lingvo.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "Choose a supported native language.")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Lingvo could not complete the request.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	})
}
