package fluo

// Defines account-owned Fluo notification preferences and privacy settings
import (
	"context"
	"errors"
)

const (
	NotifyAll       = "all"
	NotifyOff       = "off"
	NotifyFollowing = "following"
)

var ErrInvalidSettings = errors.New("invalid Fluo settings")

type NotificationPreferences struct {
	Likes     string `json:"likes"`
	Dislikes  string `json:"dislikes"`
	Replies   string `json:"replies"`
	Follows   string `json:"follows"`
	Unfollows string `json:"unfollows"`
	Quotes    string `json:"quotes"`
}

type PrivacySettings struct {
	AccountVisibility  string `json:"accountVisibility"`
	ShowLikes          bool   `json:"showLikes"`
	PresenceVisibility string `json:"presenceVisibility"`
}

type Settings struct {
	Notifications NotificationPreferences `json:"notifications"`
	Privacy       PrivacySettings         `json:"privacy"`
}

type NotificationPreferencesPatch struct {
	Likes     *string `json:"likes"`
	Dislikes  *string `json:"dislikes"`
	Replies   *string `json:"replies"`
	Follows   *string `json:"follows"`
	Unfollows *string `json:"unfollows"`
	Quotes    *string `json:"quotes"`
}

type PrivacySettingsPatch struct {
	AccountVisibility  *string `json:"accountVisibility"`
	ShowLikes          *bool   `json:"showLikes"`
	PresenceVisibility *string `json:"presenceVisibility"`
}

type SettingsPatch struct {
	Notifications *NotificationPreferencesPatch `json:"notifications"`
	Privacy       *PrivacySettingsPatch         `json:"privacy"`
}

func DefaultSettings() Settings {
	return Settings{
		Notifications: NotificationPreferences{
			Likes: NotifyAll, Dislikes: NotifyAll, Replies: NotifyAll,
			Follows: NotifyAll, Unfollows: NotifyOff, Quotes: NotifyAll,
		},
		Privacy: PrivacySettings{AccountVisibility: VisibilityPublic, ShowLikes: true, PresenceVisibility: PresenceAll},
	}
}

func (patch SettingsPatch) Validate() error {
	changed := false
	if n := patch.Notifications; n != nil {
		for _, policy := range []*string{n.Likes, n.Dislikes, n.Replies, n.Follows, n.Unfollows, n.Quotes} {
			if policy == nil {
				continue
			}
			if *policy != NotifyAll && *policy != NotifyOff && *policy != NotifyFollowing {
				return ErrInvalidSettings
			}
			changed = true
		}
		if !changed {
			return ErrInvalidSettings
		}
	}
	if p := patch.Privacy; p != nil {
		if p.AccountVisibility == nil && p.ShowLikes == nil && p.PresenceVisibility == nil {
			return ErrInvalidSettings
		}
		if p.AccountVisibility != nil && !ValidVisibility(*p.AccountVisibility) {
			return ErrInvalidSettings
		}
		if p.PresenceVisibility != nil && !ValidPresenceVisibility(*p.PresenceVisibility) {
			return ErrInvalidSettings
		}
		changed = true
	}
	if !changed {
		return ErrInvalidSettings
	}
	return nil
}

type SettingsStore interface {
	Settings(context.Context, string) (Settings, error)
	UpdateSettings(context.Context, string, SettingsPatch) (Settings, error)
}
