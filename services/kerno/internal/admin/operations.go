package admin

// Defines fixed system commands and their validation independently of HTTP and host adapters
import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

var (
	ErrInvalidOperation          = errors.New("invalid system operation")
	ErrSystemUnavailable         = errors.New("system agent unavailable")
	ErrFileReferencesUnavailable = errors.New("file-reference checks unavailable")
	ErrStorageBusy               = errors.New("file-copy operation already running")
)

type ActionRequest struct {
	Target     string `json:"target,omitempty"`
	Identity   string `json:"identity,omitempty"`
	Filesystem string `json:"filesystem,omitempty"`
}

type SystemAction struct {
	Name    string
	Reason  string
	Request ActionRequest
}

func ValidSystemAction(action string) bool {
	switch action {
	case "restart-nodo", "restart-livekit", "restart-ddclient", "scrub-filesystem", "check-storage", "repair-storage", "configure-storage":
		return true
	default:
		return false
	}
}

func (command SystemAction) Validate() error {
	if !ValidSystemAction(command.Name) {
		return fmt.Errorf("%w: Unsupported system action.", ErrInvalidOperation)
	}
	if !ValidReason(command.Reason, 10, 500) {
		return fmt.Errorf("%w: A reason of 10 to 500 characters is required.", ErrInvalidOperation)
	}
	request := command.Request
	switch command.Name {
	case "scrub-filesystem", "check-storage", "repair-storage":
		if !validMountTarget(request.Target) || (command.Name != "scrub-filesystem" && request.Target == "/") || request.Identity != "" || request.Filesystem != "" {
			return fmt.Errorf("%w: A mounted filesystem path is required.", ErrInvalidOperation)
		}
	case "configure-storage":
		if !ValidStorageDevice(request.Target, request.Identity) || request.Filesystem == "/" || !validMountTarget(request.Filesystem) {
			return fmt.Errorf("%w: A physical device, stable identity, and mounted data-pool path are required.", ErrInvalidOperation)
		}
	default:
		if request.Target != "" || request.Identity != "" || request.Filesystem != "" {
			return fmt.Errorf("%w: This operation does not accept a storage target.", ErrInvalidOperation)
		}
	}
	return nil
}

func ValidReason(reason string, minimum, maximum int) bool {
	length := utf8.RuneCountInString(reason)
	return length >= minimum && length <= maximum
}

func validStorageIdentity(identity string) bool {
	return len(identity) > len("serial:") && len(identity) <= 256 &&
		(strings.HasPrefix(identity, "serial:") || strings.HasPrefix(identity, "wwn:"))
}

func ValidStorageDevice(device, identity string) bool {
	return strings.HasPrefix(device, "/dev/") && len(device) <= 256 &&
		filepath.Clean(device) == device && validStorageIdentity(identity)
}

func validMountTarget(target string) bool {
	return len(target) <= 1024 && filepath.IsAbs(target) && filepath.Clean(target) == target
}

type LayoutRequest struct {
	Device       string `json:"device"`
	Identity     string `json:"identity"`
	Filesystem   string `json:"filesystem"`
	SystemBytes  int64  `json:"systemBytes"`
	StorageBytes int64  `json:"storageBytes"`
	Fingerprint  string `json:"fingerprint,omitempty"`
	Confirmation string `json:"confirmation,omitempty"`
}
