package httpapi

// Serves owner-scoped language dictionaries, cards, study queues and imports
import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/lingvo"
	"github.com/go-chi/chi/v5"
)

type LingvoDependencies struct{ Store lingvo.Store }
type lingvoHandler struct {
	verify VerifyFunc
	users  account.Store
	deps   LingvoDependencies
}

func mountLingvo(router chi.Router, verify VerifyFunc, users account.Store, deps LingvoDependencies) {
	h := lingvoHandler{verify: verify, users: users, deps: deps}
	router.Route("/v1/lingvo", func(r chi.Router) {
		r.Get("/catalog", h.catalog)
		r.Get("/dictionaries", h.dictionaries)
		r.Post("/dictionaries", h.createDictionary)
		r.Get("/dictionaries/{dictionaryId}", h.overview)
		r.Put("/dictionaries/{dictionaryId}/settings", h.settings)
		r.Get("/dictionaries/{dictionaryId}/cards", h.cards)
		r.Post("/dictionaries/{dictionaryId}/cards", h.createCard)
		r.Put("/dictionaries/{dictionaryId}/cards/{cardId}", h.updateCard)
		r.Delete("/dictionaries/{dictionaryId}/cards/{cardId}", h.deleteCard)
		r.Get("/dictionaries/{dictionaryId}/study", h.study)
		r.Post("/dictionaries/{dictionaryId}/cards/{cardId}/reviews", h.review)
		r.Post("/dictionaries/{dictionaryId}/reviews/{reviewId}/undo", h.undo)
		r.Post("/dictionaries/{dictionaryId}/folders", h.createFolder)
		r.Delete("/dictionaries/{dictionaryId}/folders/{folderId}", h.deleteFolder)
		r.Post("/dictionaries/{dictionaryId}/imports", h.importCards)
	})
}

func (h lingvoHandler) actor(w http.ResponseWriter, r *http.Request) (account.User, bool) {
	user, ok := authenticatedActor(w, r, h.verify, h.users, "Start a Kaordo account session before using Lingvo.")
	if !ok {
		return user, false
	}
	for _, name := range []string{"dictionaryId", "cardId", "reviewId", "folderId"} {
		if id := chi.URLParam(r, name); id != "" && !lingvo.ValidID(id) {
			writeError(w, http.StatusBadRequest, "Use a valid resource ID.")
			return user, false
		}
	}
	return user, true
}

func lingvoResponse(w http.ResponseWriter, status int, value any, err error) {
	if err == nil {
		if status == http.StatusNoContent {
			w.WriteHeader(status)
		} else {
			writeJSON(w, status, value)
		}
		return
	}
	switch {
	case errors.Is(err, lingvo.ErrNotFound):
		writeError(w, http.StatusNotFound, "Dictionary, card, review or folder not found.")
	case errors.Is(err, lingvo.ErrInvalid):
		message := strings.TrimPrefix(err.Error(), lingvo.ErrInvalid.Error()+": ")
		if message == lingvo.ErrInvalid.Error() {
			message = "Invalid language-learning request."
		}
		writeError(w, http.StatusBadRequest, message)
	case errors.Is(err, lingvo.ErrConflict):
		writeError(w, http.StatusConflict, "This card changed or was already reviewed. Refresh it and try again.")
	case errors.Is(err, lingvo.ErrExists):
		writeError(w, http.StatusConflict, "A folder with this name already exists.")
	case errors.Is(err, lingvo.ErrLimit):
		writeError(w, http.StatusConflict, "A dictionary can contain up to 10,000 cards and 100 folders.")
	default:
		log.Printf("Lingvo request failed: %v", err)
		writeError(w, http.StatusInternalServerError, "Lingvo could not complete the request.")
	}
}

func (h lingvoHandler) catalog(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.actor(w, r); !ok {
		return
	}
	items, err := lingvo.Catalog(r.URL.Query().Get("nativeLanguage"))
	lingvoResponse(w, http.StatusOK, map[string]any{"items": items}, err)
}

func (h lingvoHandler) dictionaries(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	items, err := h.deps.Store.Dictionaries(r.Context(), actor.ID)
	lingvoResponse(w, http.StatusOK, map[string]any{"items": items}, err)
}

func (h lingvoHandler) createDictionary(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input lingvo.NewDictionary
	if !decodeBody(w, r, &input) {
		return
	}
	value, err := h.deps.Store.CreateDictionary(r.Context(), actor.ID, input)
	lingvoResponse(w, http.StatusCreated, value, err)
}

func (h lingvoHandler) overview(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	value, err := h.deps.Store.Overview(r.Context(), actor.ID, chi.URLParam(r, "dictionaryId"))
	lingvoResponse(w, http.StatusOK, value, err)
}

func (h lingvoHandler) settings(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input lingvo.Settings
	if !decodeBody(w, r, &input) {
		return
	}
	value, err := h.deps.Store.UpdateSettings(r.Context(), actor.ID, chi.URLParam(r, "dictionaryId"), input)
	lingvoResponse(w, http.StatusOK, value, err)
}

func lingvoFilter(w http.ResponseWriter, r *http.Request) (lingvo.CardFilter, bool) {
	q := r.URL.Query()
	f := lingvo.CardFilter{Kind: q.Get("kind"), Status: q.Get("status"), Search: strings.TrimSpace(q.Get("q")), FolderID: q.Get("folder"), Limit: 50}
	valid := (f.Kind == "" || f.Kind == "word" || f.Kind == "phrase") &&
		(f.Status == "" || f.Status == "active" || f.Status == "known" || f.Status == "suspended") &&
		(f.FolderID == "" || f.FolderID == "none" || lingvo.ValidID(f.FolderID)) && lingvo.ValidText(f.Search, 0, 100)
	for _, parameter := range []struct {
		name     string
		value    *int
		min, max int
	}{
		{"offset", &f.Offset, 0, 10000}, {"limit", &f.Limit, 1, 200},
	} {
		if raw := q.Get(parameter.name); raw != "" {
			number, err := strconv.Atoi(raw)
			if err != nil || number < parameter.min || number > parameter.max {
				valid = false
			} else {
				*parameter.value = number
			}
		}
	}
	if !valid {
		writeError(w, http.StatusBadRequest, "Use valid card filters and pagination.")
		return f, false
	}
	return f, true
}

func (h lingvoHandler) cards(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	filter, ok := lingvoFilter(w, r)
	if !ok {
		return
	}
	value, err := h.deps.Store.Cards(r.Context(), actor.ID, chi.URLParam(r, "dictionaryId"), filter)
	lingvoResponse(w, http.StatusOK, value, err)
}

func (h lingvoHandler) study(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	filter, ok := lingvoFilter(w, r)
	if !ok {
		return
	}
	if filter.Kind == "" {
		writeError(w, http.StatusBadRequest, "Choose words or phrases to study.")
		return
	}
	items, err := h.deps.Store.Study(r.Context(), actor.ID, chi.URLParam(r, "dictionaryId"), filter)
	lingvoResponse(w, http.StatusOK, map[string]any{"items": items}, err)
}

func (h lingvoHandler) createCard(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input lingvo.NewCard
	if !decodeBody(w, r, &input) {
		return
	}
	value, err := h.deps.Store.CreateCard(r.Context(), actor.ID, chi.URLParam(r, "dictionaryId"), input)
	lingvoResponse(w, http.StatusCreated, value, err)
}

func (h lingvoHandler) updateCard(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input lingvo.CardUpdate
	if !decodeBody(w, r, &input) {
		return
	}
	if input.Revision < 1 {
		writeError(w, http.StatusBadRequest, "Use a valid card revision.")
		return
	}
	value, err := h.deps.Store.UpdateCard(r.Context(), actor.ID, chi.URLParam(r, "dictionaryId"), chi.URLParam(r, "cardId"), input)
	lingvoResponse(w, http.StatusOK, value, err)
}

func (h lingvoHandler) deleteCard(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	revision, err := strconv.ParseInt(r.URL.Query().Get("revision"), 10, 64)
	if err != nil || revision < 1 {
		writeError(w, http.StatusBadRequest, "Use a valid card revision.")
		return
	}
	err = h.deps.Store.DeleteCard(r.Context(), actor.ID, chi.URLParam(r, "dictionaryId"), chi.URLParam(r, "cardId"), revision)
	lingvoResponse(w, http.StatusNoContent, nil, err)
}

func (h lingvoHandler) review(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input lingvo.Review
	if !decodeBody(w, r, &input) {
		return
	}
	value, err := h.deps.Store.Review(r.Context(), actor.ID, chi.URLParam(r, "dictionaryId"), chi.URLParam(r, "cardId"), input)
	lingvoResponse(w, http.StatusOK, value, err)
}

func (h lingvoHandler) undo(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	value, err := h.deps.Store.Undo(r.Context(), actor.ID, chi.URLParam(r, "dictionaryId"), chi.URLParam(r, "reviewId"))
	lingvoResponse(w, http.StatusOK, value, err)
}

func (h lingvoHandler) createFolder(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	value, err := h.deps.Store.CreateFolder(r.Context(), actor.ID, chi.URLParam(r, "dictionaryId"), strings.TrimSpace(input.Name))
	lingvoResponse(w, http.StatusCreated, value, err)
}

func (h lingvoHandler) deleteFolder(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	err := h.deps.Store.DeleteFolder(r.Context(), actor.ID, chi.URLParam(r, "dictionaryId"), chi.URLParam(r, "folderId"))
	lingvoResponse(w, http.StatusNoContent, nil, err)
}

func (h lingvoHandler) importCards(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input lingvo.Import
	if !decodeBodyLimit(w, r, &input, 1<<20) {
		return
	}
	value, err := h.deps.Store.Import(r.Context(), actor.ID, chi.URLParam(r, "dictionaryId"), input)
	lingvoResponse(w, http.StatusOK, value, err)
}
