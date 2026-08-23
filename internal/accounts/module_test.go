package accounts

import (
	"context"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
	"github.com/HonmaMeikodesu/goods_hunter/internal/state"
)

type captureSender struct {
	messages []model.Mail
	err      error
}

func (s *captureSender) Send(_ context.Context, message model.Mail) error {
	if s.err != nil {
		return s.err
	}
	s.messages = append(s.messages, message)
	return nil
}

func TestRegistrationLoginAndPersistence(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := state.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	sender := &captureSender{}
	module := New(store, sender, Options{
		BaseURL: "https://hunter.example", SystemOwner: "owner@example.com",
		RegistrationTTL: 12 * time.Hour, SessionTTL: 7 * 24 * time.Hour,
	})
	if err := module.Register(context.Background(), "User@Example.com", "secret"); err != nil {
		t.Fatal(err)
	}
	if len(sender.messages) != 1 {
		t.Fatalf("registration mails = %d", len(sender.messages))
	}
	code := confirmationCode(t, sender.messages[0].Text)
	if err := module.Confirm(context.Background(), code); err != nil {
		t.Fatal(err)
	}
	if len(sender.messages) != 2 || sender.messages[1].To != "user@example.com" {
		t.Fatalf("welcome mail = %#v", sender.messages)
	}
	token, _, err := module.Login(context.Background(), "user@example.com", "secret")
	if err != nil {
		t.Fatal(err)
	}
	owner, err := module.Authenticate(context.Background(), token)
	if err != nil || owner != "user@example.com" {
		t.Fatalf("Authenticate() = %q, %v", owner, err)
	}
	if _, _, err := module.Login(context.Background(), "user@example.com", "wrong"); err != problem.ErrWrongCredentials {
		t.Fatalf("wrong password error = %v", err)
	}

	reopened, err := state.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if owner, err := reopened.SessionOwner(context.Background(), token, time.Now()); err != nil || owner != "user@example.com" {
		t.Fatalf("persisted session = %q, %v", owner, err)
	}
}

func confirmationCode(t *testing.T, text string) string {
	t.Helper()
	marker := "Accept registration: "
	index := strings.Index(text, marker)
	if index < 0 {
		t.Fatalf("confirmation link missing from %q", text)
	}
	parsed, err := url.Parse(strings.TrimSpace(text[index+len(marker):]))
	if err != nil {
		t.Fatal(err)
	}
	code := parsed.Query().Get("code")
	if code == "" {
		t.Fatal("confirmation code is empty")
	}
	return code
}
