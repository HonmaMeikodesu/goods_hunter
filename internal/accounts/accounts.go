package accounts

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html"
	"net/mail"
	"net/url"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/notify"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
	"github.com/HonmaMeikodesu/goods_hunter/internal/store"
)

type Service struct {
	db        *store.Store
	redis     *redis.Client
	sender    notify.Sender
	owner     string
	publicURL string
}

func New(db *store.Store, cache *redis.Client, sender notify.Sender, owner, publicURL string) *Service {
	return &Service{db: db, redis: cache, sender: sender, owner: owner, publicURL: publicURL}
}

const registerPrefix = "registerCode"

type registration struct {
	Email    string `json:"email"`
	Digest   string `json:"digest,omitempty"`
	Password string `json:"password,omitempty"`
}

func passwordDigest(password string) string {
	digest := sha256.Sum256([]byte(password))
	return hex.EncodeToString(digest[:])
}

func (a *Service) Register(ctx context.Context, email, password string) error {
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email || password == "" || len(email) > 255 {
		return problem.InvalidRequest
	}
	code := model.NewID()
	value, _ := json.Marshal(registration{Email: email, Digest: passwordDigest(password)})
	key := registerPrefix + code
	if err := a.redis.Set(ctx, key, value, 12*time.Hour).Err(); err != nil {
		return err
	}
	link := a.publicURL + "/register/confirm?code=" + url.QueryEscape(code)
	return a.sender.Send(ctx, notify.Message{To: a.owner,
		Subject: "You got a new user register verification to confirm",
		HTML:    "New user email: " + html.EscapeString(email) + `. <a href="` + html.EscapeString(link) + `">Confirm registration</a>.`})
}

func (a *Service) Confirm(ctx context.Context, code string) error {
	if code == "" {
		return problem.InvalidRequest
	}
	key := registerPrefix + code
	value, err := a.redis.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return problem.InvalidCode
	}
	if err != nil {
		return err
	}
	var entry registration
	if json.Unmarshal(value, &entry) != nil || entry.Email == "" || (entry.Digest == "" && entry.Password == "") {
		return problem.InvalidCode
	}
	// An unconfirmed Midway registration has a plaintext password in Redis.
	if entry.Digest == "" {
		entry.Digest = passwordDigest(entry.Password)
	}
	if err := a.db.CreateUser(ctx, entry.Email, entry.Digest); err != nil {
		return err
	}
	if err := a.redis.Del(ctx, key).Err(); err != nil {
		return err
	}
	return a.sender.Send(ctx, notify.Message{To: entry.Email,
		Subject: "Your account has been confirmed and registered, have fun and enjoy your hunting here, fresh one :)"})
}

func (a *Service) Login(ctx context.Context, email, password string) (string, error) {
	if email == "" || password == "" {
		return "", problem.InvalidRequest
	}
	owner, expected, err := a.db.LoginCredentials(ctx, email)
	if err != nil {
		return "", err
	}
	if subtle.ConstantTimeCompare([]byte(passwordDigest(password)), []byte(expected)) != 1 {
		return "", problem.WrongPassword
	}
	token := model.NewID()
	if err := a.db.SaveSession(ctx, owner, token, time.Now().AddDate(0, 0, 7)); err != nil {
		return "", err
	}
	return token, nil
}

func (a *Service) Authenticate(ctx context.Context, token string) (string, error) {
	if len(token) != 36 {
		return "", problem.InvalidLogin
	}
	owner, expires, err := a.db.Session(ctx, token)
	if err != nil {
		return "", err
	}
	if !time.Now().Before(expires) {
		return "", problem.ExpiredLogin
	}
	return owner, nil
}
