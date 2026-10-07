package httpapi

// Handles Fluo post, media, reaction, follow, and feed requests
import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
	"github.com/druckheil/Kaordo/services/mediaauth"
	"github.com/go-chi/chi/v5"
)

type MediaVerifier interface {
	Validate(context.Context, string, string) (fluo.Media, error)
	Purge(context.Context, string) error
}

type FluoDependencies struct {
	Store         fluo.Store
	Notifications fluo.NotificationStore
	Settings      fluo.SettingsStore
	Media         MediaVerifier
	MediaBaseURL  string
	MediaSignKey  []byte
}

type fluoHandler struct {
	verify VerifyFunc
	users  UserStore
	deps   FluoDependencies
}

const (
	maxPostAttachments       = 4
	invalidVisibilityMessage = "Visibility must be public or private."
)

func mountFluo(router chi.Router, verify VerifyFunc, users UserStore, deps FluoDependencies) {
	h := fluoHandler{verify: verify, users: users, deps: deps}
	router.Get("/v1/internal/media/{id}/referenced", h.mediaReferenced)
	router.Route("/v1/fluo", func(r chi.Router) {
		if deps.Settings != nil {
			r.Get("/settings", h.settings)
			r.Patch("/settings", h.updateSettings)
		}
		if deps.Notifications != nil {
			r.Get("/notifications", h.notifications)
			r.Get("/notifications/unread-count", h.notificationSummary)
			r.Put("/notifications/{id}/read", h.readNotification)
			r.Put("/notifications/read", h.readNotifications)
		}
		r.Get("/posts", h.list)
		r.Post("/posts", h.create)
		r.Put("/posts/{id}/saved", h.savePost)
		r.Delete("/posts/{id}/saved", h.unsavePost)
		r.Get("/posts/{id}", h.get)
		r.Get("/posts/{id}/thread", h.thread)
		r.Patch("/posts/{id}", h.setVisibility)
		r.Delete("/posts/{id}", h.delete)
		r.Get("/posts/{id}/comments", h.comments)
		r.Put("/posts/{id}/reaction", h.react)
		r.Delete("/posts/{id}/reaction", h.unreact)
		r.Put("/users/{id}/follow", h.follow)
		r.Delete("/users/{id}/follow", h.unfollow)
	})
}

func (h fluoHandler) actor(w http.ResponseWriter, r *http.Request) (postgres.User, bool) {
	return authenticatedActor(w, r, h.verify, h.users, "Start a Kaordo account session before using Fluo.")
}

func fluoError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, fluo.ErrNotFound):
		writeError(w, http.StatusNotFound, "Post or account not found.")
	case errors.Is(err, fluo.ErrInvalidRelation):
		writeError(w, http.StatusNotFound, "The referenced post is unavailable.")
	case errors.Is(err, fluo.ErrInvalidVisibility):
		writeError(w, http.StatusBadRequest, invalidVisibilityMessage)
	case errors.Is(err, fluo.ErrInvalidSettings):
		writeError(w, http.StatusBadRequest, "Choose a valid notification or privacy setting.")
	case errors.Is(err, fluo.ErrPrivateParent):
		writeError(w, http.StatusBadRequest, "A reply cannot be public while its parent is private.")
	case errors.Is(err, fluo.ErrSelfFollow):
		writeError(w, http.StatusBadRequest, "You cannot follow yourself.")
	case errors.Is(err, fluo.ErrRateLimited):
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "Posting too quickly. Try again in a minute.")
	case errors.Is(err, fluo.ErrMediaOwner):
		writeError(w, http.StatusBadRequest, "An attachment is unavailable or not yours.")
	default:
		writeError(w, http.StatusInternalServerError, "Fluo could not complete the request.")
	}
}

func (h fluoHandler) decorate(post *fluo.Post) error {
	if err := h.signMedia(post.Media); err != nil {
		return err
	}
	if post.Quote != nil {
		return h.signMedia(post.Quote.Media)
	}
	return nil
}

func (h fluoHandler) signMedia(items []fluo.Media) error {
	// Keep URLs stable between frequent refreshes while retaining short-lived access.
	expires := time.Now().Truncate(time.Minute).Add(9 * time.Minute)
	for index := range items {
		url, err := mediaauth.SignedURL(h.deps.MediaBaseURL, items[index].ID, expires, h.deps.MediaSignKey)
		if err != nil {
			return err
		}
		items[index].URL = url
	}
	return nil
}

func (h fluoHandler) decoratePage(page *fluo.Page) error {
	return h.decoratePosts(page.Items)
}

func (h fluoHandler) decoratePosts(posts []fluo.Post) error {
	for index := range posts {
		if err := h.decorate(&posts[index]); err != nil {
			return err
		}
	}
	return nil
}

func readPageOptions(r *http.Request, viewerID string, parentID *string) (fluo.ListOptions, error) {
	query := r.URL.Query()
	feed := query.Get("feed")
	if feed == "" {
		feed = "latest"
	}
	if feed != "latest" && feed != "following" && feed != "mine" && feed != "saved" {
		return fluo.ListOptions{}, errors.New("feed must be latest, following, mine or saved")
	}
	search := strings.TrimSpace(query.Get("q"))
	if utf8.RuneCountInString(search) > 100 || (search != "" && utf8.RuneCountInString(search) < 2) {
		return fluo.ListOptions{}, errors.New("search must contain between 2 and 100 characters")
	}
	limit, err := parseFluoPageLimit(query.Get("limit"))
	if err != nil {
		return fluo.ListOptions{}, err
	}
	cursor, err := fluo.DecodeCursor(query.Get("cursor"))
	if err != nil {
		return fluo.ListOptions{}, err
	}
	return fluo.ListOptions{ViewerID: viewerID, ParentID: parentID, Feed: feed, Search: search, Limit: limit, Cursor: cursor}, nil
}

func parseFluoPageLimit(raw string) (int, error) {
	if raw == "" {
		return 20, nil
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 50 {
		return 0, errors.New("limit must be between 1 and 50")
	}
	return limit, nil
}

func (h fluoHandler) page(w http.ResponseWriter, r *http.Request, parentID *string) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	options, err := readPageOptions(r, actor.ID, parentID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	page, err := h.deps.Store.List(r.Context(), options)
	if err != nil {
		fluoError(w, err)
		return
	}
	if err := h.decoratePage(&page); err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h fluoHandler) list(w http.ResponseWriter, r *http.Request) { h.page(w, r, nil) }

func (h fluoHandler) comments(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	h.page(w, r, &id)
}

func (h fluoHandler) get(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	post, err := h.deps.Store.Get(r.Context(), actor.ID, id)
	if err != nil {
		fluoError(w, err)
		return
	}
	if err := h.decorate(&post); err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, post)
}

func (h fluoHandler) thread(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	thread, err := h.deps.Store.Thread(r.Context(), actor.ID, id)
	if err != nil {
		fluoError(w, err)
		return
	}
	if err := h.decoratePosts(thread.Posts); err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, thread)
}

func (h fluoHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input fluo.NewPost
	if !decodeBody(w, r, &input) {
		return
	}
	text, ok := validatePostInput(w, &input)
	if !ok {
		return
	}
	media, ok := h.validatePostMedia(w, r, input)
	if !ok {
		return
	}
	createCtx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	post, err := h.deps.Store.Create(createCtx, actor.ID, input, text, media)
	if err != nil {
		fluoError(w, err)
		return
	}
	if err := h.decorate(&post); err != nil {
		fluoError(w, err)
		return
	}
	w.Header().Set("Location", "/v1/fluo/posts/"+post.ID)
	writeJSON(w, http.StatusCreated, post)
}

func validatePostInput(w http.ResponseWriter, input *fluo.NewPost) (string, bool) {
	if !validatePostReferences(w, input) {
		return "", false
	}
	maximum := 5000
	if input.ParentID != nil {
		maximum = 2000
	}
	content, text, err := fluo.ValidateContent(input.Content, maximum)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return "", false
	}
	input.Content = content
	if len(input.AttachmentIDs) > maxPostAttachments {
		writeError(w, http.StatusBadRequest, "A post can have at most four attachments.")
		return "", false
	}
	if text == "" && len(input.AttachmentIDs) == 0 && input.QuoteID == nil {
		writeError(w, http.StatusBadRequest, "Write something or attach media before publishing.")
		return "", false
	}
	return text, true
}

func validatePostReferences(w http.ResponseWriter, input *fluo.NewPost) bool {
	if input.Visibility == "" {
		input.Visibility = fluo.VisibilityPublic
	}
	if !fluo.ValidVisibility(input.Visibility) {
		writeError(w, http.StatusBadRequest, invalidVisibilityMessage)
		return false
	}
	if input.ParentID != nil && input.QuoteID != nil {
		writeError(w, http.StatusBadRequest, "A post cannot be both a reply and a quote.")
		return false
	}
	for _, reference := range []*string{input.ParentID, input.QuoteID} {
		if reference != nil && !fluo.ValidID(*reference) {
			writeError(w, http.StatusBadRequest, "Invalid referenced post ID.")
			return false
		}
	}
	return true
}

func (h fluoHandler) validatePostMedia(w http.ResponseWriter, r *http.Request, input fluo.NewPost) ([]fluo.Media, bool) {
	media := make([]fluo.Media, 0, len(input.AttachmentIDs))
	seen := make(map[string]struct{}, len(input.AttachmentIDs))
	for _, id := range input.AttachmentIDs {
		item, ok := h.validatePostAttachment(w, r, id, input.AltTexts[id], seen)
		if !ok {
			return nil, false
		}
		media = append(media, item)
	}
	for id := range input.AltTexts {
		if _, attached := seen[id]; !attached {
			writeError(w, http.StatusBadRequest, "Alt text must belong to an attached file.")
			return nil, false
		}
	}
	return media, true
}

func (h fluoHandler) validatePostAttachment(w http.ResponseWriter, r *http.Request, id, altText string, seen map[string]struct{}) (fluo.Media, bool) {
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Attachment IDs must be unique UUIDs.")
		return fluo.Media{}, false
	}
	if _, duplicate := seen[id]; duplicate {
		writeError(w, http.StatusBadRequest, "Attachment IDs must be unique UUIDs.")
		return fluo.Media{}, false
	}
	seen[id] = struct{}{}
	altText = strings.TrimSpace(altText)
	if utf8.RuneCountInString(altText) > 500 || strings.ContainsRune(altText, 0) {
		writeError(w, http.StatusBadRequest, "Alt text must be 500 characters or fewer.")
		return fluo.Media{}, false
	}
	if h.deps.Media == nil {
		writeError(w, http.StatusServiceUnavailable, "Media storage is unavailable.")
		return fluo.Media{}, false
	}
	item, err := h.deps.Media.Validate(r.Context(), r.Header.Get("Authorization"), id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "An attachment is unavailable or not yours.")
		return fluo.Media{}, false
	}
	item.AltText = altText
	return item, true
}

func (h fluoHandler) delete(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	mediaIDs, err := h.deps.Store.Delete(r.Context(), actor.ID, id)
	if err != nil {
		fluoError(w, err)
		return
	}
	if h.deps.Media != nil && len(mediaIDs) > 0 {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		for _, mediaID := range mediaIDs {
			if err := h.deps.Media.Purge(ctx, mediaID); err != nil {
				log.Printf("Kerno deferred media cleanup for %s: %v", mediaID, err)
				break
			}
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (h fluoHandler) setVisibility(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	var input struct {
		Visibility string `json:"visibility"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	if !fluo.ValidVisibility(input.Visibility) {
		writeError(w, http.StatusBadRequest, invalidVisibilityMessage)
		return
	}
	if err := h.deps.Store.SetVisibility(r.Context(), actor.ID, id, input.Visibility); err != nil {
		fluoError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (h fluoHandler) savePost(w http.ResponseWriter, r *http.Request) { h.setSaved(w, r, true) }

func (h fluoHandler) unsavePost(w http.ResponseWriter, r *http.Request) { h.setSaved(w, r, false) }

func (h fluoHandler) setSaved(w http.ResponseWriter, r *http.Request, saved bool) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	if err := h.deps.Store.SetSaved(r.Context(), actor.ID, id, saved); err != nil {
		fluoError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (h fluoHandler) mediaReferenced(w http.ResponseWriter, r *http.Request) {
	if !mediaauth.VerifyInternalToken(r.Header.Get("X-Kaordo-Internal-Token"), h.deps.MediaSignKey) {
		writeError(w, http.StatusForbidden, "Internal service access required.")
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid media ID.")
		return
	}
	referenced, err := h.deps.Store.MediaReferenced(r.Context(), id)
	if err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"referenced": referenced})
}

func (h fluoHandler) react(w http.ResponseWriter, r *http.Request)   { h.setReaction(w, r, true) }
func (h fluoHandler) unreact(w http.ResponseWriter, r *http.Request) { h.setReaction(w, r, false) }

func (h fluoHandler) setReaction(w http.ResponseWriter, r *http.Request, set bool) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid post ID.")
		return
	}
	var value *string
	if set {
		var request struct {
			Value string `json:"value"`
		}
		if !decodeBody(w, r, &request) {
			return
		}
		if request.Value != "good" && request.Value != "bad" {
			writeError(w, http.StatusBadRequest, "Reaction must be good or bad.")
			return
		}
		value = &request.Value
	}
	post, err := h.deps.Store.React(r.Context(), actor.ID, id, value)
	if err != nil {
		fluoError(w, err)
		return
	}
	if err := h.decorate(&post); err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, post)
}

func (h fluoHandler) follow(w http.ResponseWriter, r *http.Request)   { h.setFollow(w, r, true) }
func (h fluoHandler) unfollow(w http.ResponseWriter, r *http.Request) { h.setFollow(w, r, false) }

func (h fluoHandler) setFollow(w http.ResponseWriter, r *http.Request, following bool) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if !fluo.ValidID(id) {
		writeError(w, http.StatusBadRequest, "Invalid account ID.")
		return
	}
	if err := h.deps.Store.Follow(r.Context(), actor.ID, id, following); err != nil {
		fluoError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}
