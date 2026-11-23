package config

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "time/tzdata"
)

type Config struct {
	Addr      string
	PublicURL string
	MySQLDSN  string
	RedisURL  string
	ProxyPath string
	ProxyKey  []byte
	CookieKey string
	Location  *time.Location
	Email     Email
	FC        FC
	Yahoo     Yahoo
	Mobile    Mobile
}

type Mobile struct {
	Origin     string
	Code       string
	UpdatesDir string
}

type Email struct {
	User               string
	Password           string
	Host               string
	SystemOwner        string
	ContactSystemOwner string
}

type FC struct {
	AccessKeyID        string
	AccessKeySecret    string
	URL                string
	YahooFleamarketURL string
	XianyuURL          string
}

type Yahoo struct {
	SessionFile           string
	LegacyFile            string
	MaxAge                time.Duration
	AuthenticatedSelector string
}

func Load() (Config, error) {
	dir := env("GOODS_HUNTER_CONFIG_DIR", "src/private")
	cfg := Config{
		Addr:      env("GOODS_HUNTER_ADDR", ":7001"),
		MySQLDSN:  os.Getenv("GOODS_HUNTER_MYSQL_DSN"),
		RedisURL:  env("GOODS_HUNTER_REDIS_URL", "redis://127.0.0.1:6379/0"),
		ProxyPath: filepath.Join(dir, "config.yaml"),
		CookieKey: os.Getenv("GOODS_HUNTER_COOKIE_KEY"),
		Yahoo: Yahoo{
			SessionFile:           os.Getenv("YAHOO_SESSION_FILE"),
			LegacyFile:            env("YAHOO_COOKIE_FILE", filepath.Join(dir, "yahoo.json")),
			AuthenticatedSelector: os.Getenv("YAHOO_AUTH_SELECTOR"),
		},
	}
	var err error
	cfg.Location, err = time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return Config{}, err
	}
	var server struct{ ServerHost string }
	var secret struct{ K string }
	for name, dest := range map[string]any{
		"server.json": &server, "secret.json": &secret,
		"email.json": &cfg.Email, "alicloud.json": &cfg.FC,
	} {
		if err := readConfig(filepath.Join(dir, name), dest); err != nil {
			return Config{}, err
		}
	}
	cfg.PublicURL = env("GOODS_HUNTER_PUBLIC_URL", server.ServerHost)
	if cfg.PublicURL == "" {
		cfg.PublicURL = "http://localhost:7001"
	} else if !strings.Contains(cfg.PublicURL, "://") {
		cfg.PublicURL = "http://" + cfg.PublicURL
	}
	public, parseErr := url.Parse(cfg.PublicURL)
	if parseErr != nil || public.Hostname() == "" || public.User != nil ||
		(public.Scheme != "http" && public.Scheme != "https") ||
		(public.Path != "" && public.Path != "/") || public.RawQuery != "" || public.Fragment != "" {
		return Config{}, errors.New("invalid public URL")
	}
	cfg.PublicURL = strings.TrimRight(cfg.PublicURL, "/")
	if secret.K != "" {
		cfg.ProxyKey, err = base64.RawURLEncoding.DecodeString(strings.TrimRight(secret.K, "="))
		if err != nil {
			return Config{}, errors.New("invalid proxy key in secret.json")
		}
	}
	cfg.FC.YahooFleamarketURL = env("YAHOO_FLEAMARKET_FC_URL", cfg.FC.YahooFleamarketURL)
	cfg.FC.XianyuURL = env("XIANYU_FC_URL", cfg.FC.XianyuURL)
	maxAge, err := strconv.ParseInt(env("YAHOO_SESSION_MAX_AGE_SECONDS", "21600"), 10, 32)
	if err != nil || maxAge <= 0 {
		return Config{}, errors.New("YAHOO_SESSION_MAX_AGE_SECONDS must be a positive integer")
	}
	cfg.Yahoo.MaxAge = time.Duration(maxAge) * time.Second
	cfg.Mobile = Mobile{
		Origin:     strings.TrimRight(os.Getenv("GOODS_HUNTER_MOBILE_ORIGIN"), "/"),
		Code:       os.Getenv("GOODS_HUNTER_MOBILE_CODE"),
		UpdatesDir: os.Getenv("GOODS_HUNTER_UPDATES_DIR"),
	}
	if cfg.Mobile.Origin != "" {
		origin, err := url.Parse(cfg.Mobile.Origin)
		if err != nil || origin.Scheme != "https" || origin.Hostname() == "" || origin.User != nil ||
			origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" || len(cfg.Mobile.Code) < 32 {
			return Config{}, errors.New("mobile production configuration requires an HTTPS origin and a strong connection code")
		}
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func readConfig(path string, dest any) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}
	if json.Unmarshal(data, dest) != nil {
		return fmt.Errorf("invalid JSON in %s", filepath.Base(path))
	}
	return nil
}
