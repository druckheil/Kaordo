package httpapi

// Coordinates authenticated profile editing, cropped image validation and follower lists
import (
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/go-chi/chi/v5"
)

func (h fluoHandler) profile(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	username := chi.URLParam(r, "username")
	if r.URL.RawPath != "" {
		decoded, err := url.PathUnescape(username)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid username.")
			return
		}
		username = decoded
	}
	if username == "" || utf8.RuneCountInString(username) > 255 || strings.ContainsRune(username, '\x00') {
		writeError(w, http.StatusBadRequest, "Invalid username.")
		return
	}
	profile, err := h.deps.Profiles.Profile(r.Context(), actor.ID, username)
	if err != nil {
		fluoError(w, err)
		return
	}
	h.writeProfile(w, profile)
}

func (h fluoHandler) writeProfile(w http.ResponseWriter, profile fluo.Profile) {
	if err := h.signImage(profile.Avatar); err != nil {
		fluoError(w, err)
		return
	}
	if err := h.signImage(profile.Banner); err != nil {
		fluoError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (h fluoHandler) updateProfile(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input fluo.ProfileUpdate
	if !decodeBody(w, r, &input) {
		return
	}
	input.Normalize()
	if err := input.Validate(time.Now()); err != nil {
		fluoError(w, err)
		return
	}
	current, err := h.deps.Profiles.Profile(r.Context(), actor.ID, actor.Username)
	if err != nil {
		fluoError(w, err)
		return
	}
	if current.ID != actor.ID {
		fluoError(w, fluo.ErrMediaOwner)
		return
	}
	images, ok := h.validateProfileImages(w, r, input, current)
	if !ok {
		return
	}
	profile, retired, err := h.deps.Profiles.UpdateProfile(r.Context(), actor.ID, input, images)
	if err != nil {
		fluoError(w, err)
		return
	}
	h.purgeRetiredMedia(r.Context(), retired)
	h.writeProfile(w, profile)
}

func (h fluoHandler) validateProfileImages(w http.ResponseWriter, r *http.Request, input fluo.ProfileUpdate, current fluo.Profile) ([]fluo.ProfileImage, bool) {
	images := make([]fluo.ProfileImage, 0, 2)
	for _, field := range []struct {
		slot    string
		id      *string
		current *fluo.Media
	}{{"avatar", input.AvatarID, current.Avatar}, {"banner", input.BannerID, current.Banner}} {
		if field.id == nil {
			continue
		}
		// Stored image metadata remains authoritative after the upload acceptance window expires.
		if field.current != nil && strings.EqualFold(*field.id, field.current.ID) {
			images = append(images, fluo.ProfileImage{Slot: field.slot, Media: *field.current})
			continue
		}
		if h.deps.Media == nil {
			writeError(w, http.StatusServiceUnavailable, "Media storage is unavailable.")
			return nil, false
		}
		media, err := h.deps.Media.Validate(r.Context(), r.Header.Get("Authorization"), *field.id)
		if err != nil {
			fluoError(w, fluo.ErrMediaOwner)
			return nil, false
		}
		image := fluo.ProfileImage{Slot: field.slot, Media: media}
		if err := image.Validate(); err != nil {
			fluoError(w, err)
			return nil, false
		}
		images = append(images, image)
	}
	return images, true
}

func (h fluoHandler) setStatus(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input struct {
		Status string `json:"status"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	if !fluo.ValidStatus(input.Status) {
		writeError(w, http.StatusBadRequest, "Choose Online, Busy or Invisible.")
		return
	}
	profile, err := h.deps.Profiles.SetStatus(r.Context(), actor.ID, input.Status)
	if err != nil {
		fluoError(w, err)
		return
	}
	h.writeProfile(w, profile)
}

func (h fluoHandler) touchPresence(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var input struct {
		UserIDs []string `json:"userIds"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	if len(input.UserIDs) < 1 || len(input.UserIDs) > 128 {
		writeError(w, http.StatusBadRequest, "Choose between 1 and 128 accounts.")
		return
	}
	seen := make(map[string]struct{}, len(input.UserIDs))
	for _, id := range input.UserIDs {
		key := strings.ToLower(id)
		_, duplicate := seen[key]
		if !fluo.ValidID(id) || duplicate {
			writeError(w, http.StatusBadRequest, "Choose unique, valid accounts.")
			return
		}
		seen[key] = struct{}{}
	}
	if err := h.deps.Profiles.TouchPresence(r.Context(), actor.ID); err != nil {
		fluoError(w, err)
		return
	}
	items, err := h.deps.Profiles.Presentations(r.Context(), actor.ID, input.UserIDs)
	if err != nil {
		fluoError(w, err)
		return
	}
	for _, item := range items {
		if err := h.signImage(item.Avatar); err != nil {
			fluoError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, struct {
		Items []fluo.UserPresentation `json:"items"`
	}{Items: items})
}

func (h fluoHandler) connections(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	options := fluo.ConnectionOptions{ViewerID: actor.ID, UserID: chi.URLParam(r, "id"), Kind: r.URL.Query().Get("kind")}
	if !fluo.ValidID(options.UserID) || (options.Kind != "followers" && options.Kind != "following") {
		writeError(w, http.StatusBadRequest, "Choose a valid profile and follow list.")
		return
	}
	var err error
	options.Limit, err = parseFluoPageLimit(r.URL.Query().Get("limit"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	options.Cursor, err = fluo.DecodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	page, err := h.deps.Profiles.Connections(r.Context(), options)
	if err != nil {
		fluoError(w, err)
		return
	}
	for index := range page.Items {
		if err := h.signImage(page.Items[index].Avatar); err != nil {
			fluoError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, page)
}
