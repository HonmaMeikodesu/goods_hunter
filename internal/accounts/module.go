// Package accounts owns registration, password verification, and login-state
// lifecycle behind one small account interface.
package accounts

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
	"github.com/HonmaMeikodesu/goods_hunter/internal/state"
)

type Sender interface {
	Send(context.Context, model.Mail) error
}

type Module struct {
	store           *state.Store
	sender          Sender
	logger          *slog.Logger
	baseURL         string
	systemOwner     string
	registrationTTL time.Duration
	sessionTTL      time.Duration
	now             func() time.Time
}

type Options struct {
	BaseURL         string
	SystemOwner     string
	RegistrationTTL time.Duration
	SessionTTL      time.Duration
	Logger          *slog.Logger
}

func New(store *state.Store, sender Sender, options Options) *Module {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &Module{
		store: store, sender: sender, logger: logger,
		baseURL: strings.TrimRight(options.BaseURL, "/"), systemOwner: options.SystemOwner,
		registrationTTL: options.RegistrationTTL, sessionTTL: options.SessionTTL,
		now: time.Now,
	}
}

func (m *Module) Register(ctx context.Context, email, password string) error {
	email = state.CanonicalEmail(email)
	if !validEmail(email) || password == "" || len(password) > 4096 || m.registrationTTL <= 0 {
		return problem.ErrInvalidRequest
	}
	if strings.TrimSpace(m.systemOwner) == "" {
		return fmt.Errorf("registration requires a configured system owner")
	}
	digest, err := hashPassword(password)
	if err != nil {
		return err
	}
	code, err := randomID()
	if err != nil {
		return err
	}
	if err := m.store.PutPendingRegistration(ctx, code, email, digest, m.now().Add(m.registrationTTL)); err != nil {
		return err
	}
	confirmation := m.baseURL + "/register/confirm?code=" + url.QueryEscape(code)
	message := model.Mail{
		To:      m.systemOwner,
		Subject: "You got a new user registration to confirm",
		HTML:    fmt.Sprintf("New user email: %s. <a href=\"%s\">Accept registration</a>.", htmlEscape(email), htmlEscape(confirmation)),
		Text:    fmt.Sprintf("New user email: %s. Accept registration: %s", email, confirmation),
	}
	if err := m.sender.Send(ctx, message); err != nil {
		_ = m.store.DeletePendingRegistration(context.WithoutCancel(ctx), code)
		return fmt.Errorf("send registration confirmation: %w", err)
	}
	return nil
}

func (m *Module) Confirm(ctx context.Context, code string) error {
	if strings.TrimSpace(code) == "" {
		return problem.ErrInvalidRequest
	}
	// Read the target email before consuming the code is intentionally avoided:
	// state performs user creation and code consumption as one atomic mutation.
	email, err := m.store.ConfirmRegistration(ctx, code, m.now())
	if err != nil {
		return err
	}
	if err := m.sender.Send(ctx, model.Mail{
		To:      email,
		Subject: "Your Goods Hunter account has been confirmed",
		Text:    "Your account has been confirmed and registered. Welcome to Goods Hunter.",
		HTML:    "<p>Your account has been confirmed and registered. Welcome to Goods Hunter.</p>",
	}); err != nil {
		// Registration is already committed atomically. A welcome-message outage
		// must not turn a successful confirmation into an unusable code retry.
		m.logger.Warn("welcome mail failed after registration", "email", email, "error", err)
	}
	return nil
}

func (m *Module) Login(ctx context.Context, email, password string) (string, time.Time, error) {
	email = state.CanonicalEmail(email)
	if !validEmail(email) || password == "" || m.sessionTTL <= 0 {
		return "", time.Time{}, problem.ErrInvalidRequest
	}
	digest, exists, err := m.store.UserPassword(ctx, email)
	if err != nil {
		return "", time.Time{}, err
	}
	if !exists {
		return "", time.Time{}, problem.ErrWrongCredentials
	}
	valid, legacy, verifyErr := verifyPassword(digest, password)
	if verifyErr != nil || !valid {
		return "", time.Time{}, problem.ErrWrongCredentials
	}
	now := m.now()
	if legacy {
		upgraded, hashErr := hashPassword(password)
		if hashErr != nil {
			return "", time.Time{}, hashErr
		}
		if err := m.store.UpgradePassword(ctx, email, digest, upgraded, now); err != nil {
			return "", time.Time{}, err
		}
	}
	token, err := randomID()
	if err != nil {
		return "", time.Time{}, err
	}
	expiresAt := now.Add(m.sessionTTL)
	if err := m.store.PutSession(ctx, token, email, expiresAt); err != nil {
		return "", time.Time{}, err
	}
	return token, expiresAt, nil
}

func (m *Module) Authenticate(ctx context.Context, token string) (string, error) {
	if strings.TrimSpace(token) == "" {
		return "", problem.ErrMissingLoginState
	}
	return m.store.SessionOwner(ctx, token, m.now())
}

func validEmail(value string) bool {
	parsed, err := mail.ParseAddress(value)
	return err == nil && state.CanonicalEmail(parsed.Address) == value
}

func randomID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate random id: %w", err)
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(raw)
	return hexValue[0:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:32], nil
}

func htmlEscape(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&#39;")
	return replacer.Replace(value)
}
