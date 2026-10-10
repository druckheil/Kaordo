package admin

// Defines fixed system commands and their validation independently of HTTP and host adapters
import (
	"errors"
	"slices"
	"unicode/utf8"

	"github.com/druckheil/Kaordo/services/kerno/internal/invalid"
)

var (
	ErrInvalidOperation  = errors.New("invalid system operation")
	ErrSystemUnavailable = errors.New("system agent unavailable")
	ErrMediaUnavailable  = errors.New("media maintenance unavailable")
	ErrMediaBusy         = errors.New("media maintenance already running")
)

// Host actions run through regado-agent; media actions run in Nodo, which owns stored files.
var (
	hostActions  = []string{"restart-nodo", "restart-livekit", "restart-ddclient"}
	mediaActions = map[string]bool{"check-media": false, "clean-media": true}
)

type SystemAction struct {
	Name   string
	Reason string
}

func ValidSystemAction(action string) bool {
	_, media := mediaActions[action]
	return media || slices.Contains(hostActions, action)
}

func (command SystemAction) Validate() error {
	if !ValidSystemAction(command.Name) {
		return invalid.Input(ErrInvalidOperation, "Unsupported system action.")
	}
	if !ValidReason(command.Reason) {
		return invalid.Input(ErrInvalidOperation, "The reason must be at most 500 characters.")
	}
	return nil
}

func ValidReason(reason string) bool {
	return utf8.RuneCountInString(reason) <= 500
}
