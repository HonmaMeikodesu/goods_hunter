// Package problem defines the stable error codes exposed by the HTTP transport.
package problem

import (
	"errors"
	"fmt"
)

// Error is safe to expose to a client. Internal errors must be wrapped as a
// system error by the transport instead of leaking implementation details.
type Error struct {
	Code       string
	HTTPStatus int
	Message    string
}

func (e *Error) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("%s: %s", e.Code, e.Message)
	}
	return e.Code
}

var (
	ErrMissingLoginState   = &Error{Code: "010101", HTTPStatus: 400, Message: "missing login state"}
	ErrInvalidLoginState   = &Error{Code: "010102", HTTPStatus: 400, Message: "invalid login state"}
	ErrExpiredLoginState   = &Error{Code: "010103", HTTPStatus: 400, Message: "expired login state"}
	ErrWrongCredentials    = &Error{Code: "030301", HTTPStatus: 400, Message: "wrong email or password"}
	ErrUserAlreadyExists   = &Error{Code: "030401", HTTPStatus: 400, Message: "user already exists"}
	ErrInvalidRegisterCode = &Error{Code: "030402", HTTPStatus: 400, Message: "invalid verification code"}
	ErrTaskNotFound        = &Error{Code: "030502", HTTPStatus: 400, Message: "watcher not found"}
	ErrTaskPermission      = &Error{Code: "030503", HTTPStatus: 403, Message: "watcher permission denied"}
	ErrDuplicateTask       = &Error{Code: "030504", HTTPStatus: 400, Message: "duplicate watcher"}
	ErrMessageCorrupted    = &Error{Code: "030601", HTTPStatus: 400, Message: "message corrupted"}
	ErrMessageConsumed     = &Error{Code: "030602", HTTPStatus: 400, Message: "message consumed"}
	ErrScheduleNotFound    = &Error{Code: "030801", HTTPStatus: 400, Message: "schedule not found"}
	ErrInvalidRequest      = &Error{Code: "040001", HTTPStatus: 400, Message: "invalid request"}
)

// Public returns a stable client-facing error when err contains one.
func Public(err error) (*Error, bool) {
	var target *Error
	if errors.As(err, &target) {
		return target, true
	}
	return nil, false
}
