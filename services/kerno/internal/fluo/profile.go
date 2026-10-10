package fluo

// Defines editable profiles, image slots and privacy-aware presence
import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/invalid"
)

const (
	StatusOnline     = "online"
	StatusBusy       = "busy"
	StatusInvisible  = "invisible"
	PresenceAll      = "all"
	PresenceFriends  = "friends"
	PresenceOff      = "off"
	PresenceLifetime = 7 * time.Second
)

var ErrInvalidProfile = errors.New("invalid profile")

type Profile struct {
	Author
	Bio               string    `json:"bio"`
	BirthDate         *string   `json:"birthDate"`
	Location          string    `json:"location"`
	Website           string    `json:"website"`
	Pronouns          string    `json:"pronouns"`
	Banner            *Media    `json:"banner"`
	CreatedAt         time.Time `json:"createdAt"`
	FollowersCount    int64     `json:"followersCount"`
	FollowingCount    int64     `json:"followingCount"`
	FollowedBy        bool      `json:"followedBy"`
	AccountVisibility string    `json:"accountVisibility"`
	CanViewPosts      bool      `json:"canViewPosts"`
	Presence          *string   `json:"presence"`
	Status            string    `json:"status,omitempty"`
}

type ProfileUpdate struct {
	Nickname  string  `json:"nickname"`
	Bio       string  `json:"bio"`
	BirthDate *string `json:"birthDate"`
	Location  string  `json:"location"`
	Website   string  `json:"website"`
	Pronouns  string  `json:"pronouns"`
	AvatarID  *string `json:"avatarId"`
	BannerID  *string `json:"bannerId"`
}

type ProfileImage struct {
	Slot string
	Media
}

type UserPresentation struct {
	ID       string  `json:"id"`
	Avatar   *Media  `json:"avatar"`
	Presence *string `json:"presence"`
}

func (image ProfileImage) Validate() error {
	ratio := 1
	if image.Slot == "banner" {
		ratio = 3
	} else if image.Slot != "avatar" {
		return ErrInvalidProfile
	}
	validType := image.MimeType == "image/jpeg" || image.MimeType == "image/png" || image.MimeType == "image/webp"
	if image.Kind != "image" || !validType || image.Width < 1 || image.Width > 8192 || image.Height < 1 ||
		image.Height > 8192 || image.Width != image.Height*ratio || image.Size < 1 || image.Size > 20*1024*1024 {
		return invalid.Input(ErrInvalidProfile, "Choose a cropped square avatar or a 3:1 banner image, up to 20 MiB.")
	}
	return nil
}

func (input ProfileUpdate) ValidateImages(images []ProfileImage) error {
	wanted := map[string]*string{"avatar": input.AvatarID, "banner": input.BannerID}
	for _, image := range images {
		id := wanted[image.Slot]
		if id == nil || !strings.EqualFold(*id, image.ID) {
			return ErrMediaOwner
		}
		if err := image.Validate(); err != nil {
			return err
		}
		delete(wanted, image.Slot)
	}
	for _, id := range wanted {
		if id != nil {
			return ErrMediaOwner
		}
	}
	return nil
}

func (input *ProfileUpdate) Normalize() {
	input.Nickname = strings.TrimSpace(input.Nickname)
	input.Bio = strings.TrimSpace(input.Bio)
	input.Location = strings.TrimSpace(input.Location)
	input.Website = strings.TrimSpace(input.Website)
	input.Pronouns = strings.TrimSpace(input.Pronouns)
}

func (input ProfileUpdate) Validate(now time.Time) error {
	for _, field := range []struct {
		name, value string
		limit       int
		multiline   bool
	}{
		{"Nickname", input.Nickname, 80, false}, {"Bio", input.Bio, 500, true},
		{"Location", input.Location, 100, false}, {"Website", input.Website, 300, false},
		{"Pronouns", input.Pronouns, 40, false},
	} {
		if err := validateProfileText(field.name, field.value, field.limit, field.multiline); err != nil {
			return err
		}
	}
	if input.Nickname == "" {
		return invalid.Input(ErrInvalidProfile, "Enter a nickname.")
	}
	if input.BirthDate != nil {
		date, err := time.Parse(time.DateOnly, *input.BirthDate)
		if err != nil || date.Before(time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC)) || date.Format(time.DateOnly) > now.UTC().Format(time.DateOnly) {
			return invalid.Input(ErrInvalidProfile, "Choose a valid birth date that is not in the future.")
		}
	}
	if input.Website != "" {
		website, err := url.Parse(input.Website)
		if err != nil || (website.Scheme != "https" && website.Scheme != "http") || website.Hostname() == "" || website.User != nil {
			return invalid.Input(ErrInvalidProfile, "Enter a full website URL starting with https:// or http://.")
		}
	}
	for _, id := range []*string{input.AvatarID, input.BannerID} {
		if id != nil && !ValidID(*id) {
			return ErrMediaOwner
		}
	}
	return nil
}

func validateProfileText(name, value string, limit int, multiline bool) error {
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > limit {
		return invalid.Input(ErrInvalidProfile, fmt.Sprintf("%s must contain at most %d characters.", name, limit))
	}
	for _, character := range value {
		allowedBreak := multiline && (character == '\n' || character == '\r' || character == '\t')
		if unicode.IsControl(character) && !allowedBreak {
			return invalid.Input(ErrInvalidProfile, name+" contains an unsupported character.")
		}
	}
	return nil
}

func ValidStatus(value string) bool {
	return value == StatusOnline || value == StatusBusy || value == StatusInvisible
}

func ValidPresenceVisibility(value string) bool {
	return value == PresenceAll || value == PresenceFriends || value == PresenceOff
}

type ConnectionOptions struct {
	ViewerID, UserID, Kind string
	Cursor                 *Cursor
	Limit                  int
}

type ConnectionPage struct {
	Items      []Author `json:"items"`
	NextCursor *string  `json:"nextCursor"`
}

type ProfileStore interface {
	Profile(context.Context, string, string) (Profile, error)
	UpdateProfile(context.Context, string, ProfileUpdate, []ProfileImage) (Profile, []string, error)
	Connections(context.Context, ConnectionOptions) (ConnectionPage, error)
	SetStatus(context.Context, string, string) (Profile, error)
	TouchPresence(context.Context, string) error
	Presentations(context.Context, string, []string) ([]UserPresentation, error)
}
