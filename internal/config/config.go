// Package config loads runtime settings from environment variables and the
// legacy private directory without logging secret values.
package config

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type SMTP struct {
	Host               string
	Port               int
	User               string
	Password           string
	SystemOwner        string
	ContactSystemOwner string
	TLSMode            string
}

type AliCloud struct {
	AccessKeyID     string `json:"accessKeyId"`
	AccessKeySecret string `json:"accessKeySecret"`
	URL             string `json:"url"`
}

type Config struct {
	ListenAddress   string
	BaseURL         string
	DataFile        string
	PrivateDir      string
	ProxyConfigPath string
	YahooCookie     string
	SecretKey       []byte
	SMTP            SMTP
	AliCloud        AliCloud
	SessionTTL      time.Duration
	RegistrationTTL time.Duration
	SecureCookie    bool
	MailMode        string
}

type legacyServer struct {
	ServerHost string `json:"serverHost"`
}

type legacyEmail struct {
	User               string `json:"user"`
	Password           string `json:"password"`
	Host               string `json:"host"`
	SystemOwner        string `json:"systemOwner"`
	ContactSystemOwner string `json:"contactSystemOwner"`
}

type jwk struct {
	Key string `json:"k"`
}

func Load() (Config, error) {
	privateDir := env("GH_PRIVATE_DIR", filepath.Join("src", "private"))
	cfg := Config{
		ListenAddress:   env("GH_LISTEN_ADDRESS", ":7001"),
		DataFile:        env("GH_DATA_FILE", filepath.Join("var", "goods-hunter.json")),
		PrivateDir:      privateDir,
		ProxyConfigPath: env("GH_PROXY_CONFIG", filepath.Join(privateDir, "config.yaml")),
		SessionTTL:      7 * 24 * time.Hour,
		RegistrationTTL: 12 * time.Hour,
		SecureCookie:    envBool("GH_SECURE_COOKIE", false),
		MailMode:        strings.ToLower(env("GH_MAIL_MODE", "")),
	}

	var server legacyServer
	if err := readOptionalJSON(filepath.Join(privateDir, "server.json"), &server); err != nil {
		return Config{}, err
	}
	host := env("GH_SERVER_HOST", server.ServerHost)
	if host == "" {
		listenHost, port, splitErr := net.SplitHostPort(cfg.ListenAddress)
		if splitErr == nil {
			if listenHost == "" || listenHost == "0.0.0.0" || listenHost == "::" {
				listenHost = "localhost"
			}
			host = net.JoinHostPort(listenHost, port)
		} else {
			host = cfg.ListenAddress
		}
	}
	if strings.HasPrefix(host, "http://") || strings.HasPrefix(host, "https://") {
		cfg.BaseURL = strings.TrimRight(host, "/")
	} else {
		scheme := "http://"
		if cfg.SecureCookie {
			scheme = "https://"
		}
		cfg.BaseURL = scheme + strings.TrimRight(host, "/")
	}

	var email legacyEmail
	if err := readOptionalJSON(filepath.Join(privateDir, "email.json"), &email); err != nil {
		return Config{}, err
	}
	cfg.SMTP = SMTP{
		Host:               env("GH_SMTP_HOST", email.Host),
		Port:               envInt("GH_SMTP_PORT", 465),
		User:               env("GH_SMTP_USER", email.User),
		Password:           env("GH_SMTP_PASSWORD", email.Password),
		SystemOwner:        env("GH_SYSTEM_OWNER", email.SystemOwner),
		ContactSystemOwner: env("GH_CONTACT_SYSTEM_OWNER", email.ContactSystemOwner),
		TLSMode:            strings.ToLower(env("GH_SMTP_TLS_MODE", "implicit")),
	}
	if cfg.MailMode == "" {
		if cfg.SMTP.Host != "" && cfg.SMTP.SystemOwner != "" {
			cfg.MailMode = "smtp"
		} else {
			cfg.MailMode = "log"
		}
	}

	if err := readOptionalJSON(filepath.Join(privateDir, "alicloud.json"), &cfg.AliCloud); err != nil {
		return Config{}, err
	}
	cfg.AliCloud.AccessKeyID = env("GH_ALICLOUD_ACCESS_KEY_ID", cfg.AliCloud.AccessKeyID)
	cfg.AliCloud.AccessKeySecret = env("GH_ALICLOUD_ACCESS_KEY_SECRET", cfg.AliCloud.AccessKeySecret)
	cfg.AliCloud.URL = env("GH_ALICLOUD_URL", cfg.AliCloud.URL)

	if cookie, err := os.ReadFile(filepath.Join(privateDir, "yahoo.json")); err == nil {
		cfg.YahooCookie = strings.TrimSpace(string(cookie))
	} else if !errors.Is(err, os.ErrNotExist) {
		return Config{}, fmt.Errorf("read yahoo cookie: %w", err)
	}
	cfg.YahooCookie = env("GH_YAHOO_COOKIE", cfg.YahooCookie)

	var key jwk
	if err := readOptionalJSON(filepath.Join(privateDir, "secret.json"), &key); err != nil {
		return Config{}, err
	}
	if key.Key != "" {
		decoded, decodeErr := base64.RawURLEncoding.DecodeString(key.Key)
		if decodeErr != nil {
			return Config{}, fmt.Errorf("decode secret JWK: %w", decodeErr)
		}
		if len(decoded) != 16 && len(decoded) != 24 && len(decoded) != 32 {
			return Config{}, fmt.Errorf("secret JWK contains invalid AES key length %d", len(decoded))
		}
		cfg.SecretKey = decoded
	}

	if raw := os.Getenv("GH_SESSION_TTL"); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			return Config{}, errors.New("GH_SESSION_TTL must be a positive duration")
		}
		cfg.SessionTTL = d
	}
	if raw := os.Getenv("GH_REGISTRATION_TTL"); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			return Config{}, errors.New("GH_REGISTRATION_TTL must be a positive duration")
		}
		cfg.RegistrationTTL = d
	}
	return cfg, nil
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	return nil
}

func readOptionalJSON(path string, target any) error {
	err := readJSON(path, target)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func env(name, fallback string) string {
	if value, ok := os.LookupEnv(name); ok {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) int {
	value, ok := os.LookupEnv(name)
	if !ok || value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envBool(name string, fallback bool) bool {
	value, ok := os.LookupEnv(name)
	if !ok || value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
