// Package invalid marks validation failures whose message is safe to show to the user.
package invalid

// Wraps a sentinel error with user-facing text without encoding the text in Error()
import "errors"

type inputError struct {
	kind    error
	message string
}

// Input reports a validation failure. errors.Is matches kind; Message returns message.
func Input(kind error, message string) error {
	return &inputError{kind: kind, message: message}
}

func (err *inputError) Error() string { return err.kind.Error() + ": " + err.message }

func (err *inputError) Unwrap() error { return err.kind }

// Message returns the user-facing text of a validation failure created by Input.
func Message(err error) (string, bool) {
	var input *inputError
	if errors.As(err, &input) {
		return input.message, true
	}
	return "", false
}
