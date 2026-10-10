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

// Validate requires at least one known setting and rejects unknown values
func (patch SettingsPatch) Validate() error {
	if patch.Notifications == nil && patch.Privacy == nil ||
		patch.Notifications != nil && !patch.Notifications.valid() ||
		patch.Privacy != nil && !patch.Privacy.valid() {
		return ErrInvalidSettings
	}
	return nil
}

func (patch NotificationPreferencesPatch) valid() bool {
	changed := false
	for _, policy := range []*string{patch.Likes, patch.Dislikes, patch.Replies, patch.Follows, patch.Unfollows, patch.Quotes} {
		if policy == nil {
			continue
		}
		if *policy != NotifyAll && *policy != NotifyOff && *policy != NotifyFollowing {
			return false
		}
		changed = true
	}
	return changed
}

func (patch PrivacySettingsPatch) valid() bool {
	if patch.AccountVisibility == nil && patch.ShowLikes == nil && patch.PresenceVisibility == nil {
		return false
	}
	return (patch.AccountVisibility == nil || ValidVisibility(*patch.AccountVisibility)) &&
		(patch.PresenceVisibility == nil || ValidPresenceVisibility(*patch.PresenceVisibility))
}

type SettingsStore interface {
	Settings(context.Context, string) (Settings, error)
	UpdateSettings(context.Context, string, SettingsPatch) (Settings, error)
}
