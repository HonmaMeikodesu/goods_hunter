package market

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/andybalholm/cascadia"
)

const defaultYahooSelector = `a[href*="login.yahoo.co.jp"][href*="logout"], a[href="/my/bidding"], a[href="https://auctions.yahoo.co.jp/my/bidding"]`

type cookie struct {
	Name         string   `json:"name"`
	Value        string   `json:"value"`
	Domain       string   `json:"domain"`
	Path         string   `json:"path"`
	Expires      *float64 `json:"expires,omitempty"`
	HTTPOnly     *bool    `json:"httpOnly,omitempty"`
	Secure       *bool    `json:"secure,omitempty"`
	SameSite     *string  `json:"sameSite,omitempty"`
	PartitionKey *string  `json:"partitionKey,omitempty"`
}

var surugayaCookies = []cookie{
	{Name: "safe_search_option", Value: "3", Domain: "www.suruga-ya.jp", Path: "/"},
	{Name: "safe_search_expired", Value: "3", Domain: "www.suruga-ya.jp", Path: "/"},
}

var mandarakeCookies = []cookie{
	{Name: "_ga", Value: "0", Domain: "order.mandarake.co.jp", Path: "/"},
	{Name: "_gat", Value: "0", Domain: "order.mandarake.co.jp", Path: "/"},
	{Name: "_gid", Value: "0", Domain: "order.mandarake.co.jp", Path: "/"},
	{Name: "mandarake_url", Value: "0", Domain: "order.mandarake.co.jp", Path: "/"},
	{Name: "tr_mndrk_user", Value: "0", Domain: "order.mandarake.co.jp", Path: "/"},
}

func (c *Client) yahooCookies(now time.Time) ([]cookie, error) {
	if c.yahoo.SessionFile == "" {
		if c.yahoo.LegacyFile == "" {
			return nil, nil
		}
		data, err := os.ReadFile(c.yahoo.LegacyFile)
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		if err != nil {
			return nil, LegacyUnreadable
		}
		var cookies []cookie
		raw := strings.NewReplacer("\r", "", "\n", "").Replace(string(data))
		for _, pair := range strings.Split(raw, ";") {
			name, value, ok := strings.Cut(strings.TrimSpace(pair), "=")
			if ok && name != "" && value != "" {
				cookies = append(cookies, cookie{Name: name, Value: value, Domain: "auctions.yahoo.co.jp", Path: "/"})
			}
		}
		return cookies, nil
	}

	data, err := os.ReadFile(c.yahoo.SessionFile)
	if err != nil || !json.Valid(data) {
		return nil, StateUnreadable
	}
	var state struct {
		Version     int
		Status      string
		ValidatedAt string
		Cookies     json.RawMessage
	}
	if json.Unmarshal(data, &state) != nil || state.Version != 1 {
		return nil, StateInvalid
	}
	switch state.Status {
	case "needs_login":
		return nil, Failure("NEEDS_LOGIN")
	case "ready", "error":
	default:
		return nil, StateInvalid
	}
	validatedAt, err := time.Parse(time.RFC3339, state.ValidatedAt)
	maxAge := c.yahoo.MaxAge
	if maxAge == 0 {
		maxAge = 6 * time.Hour
	}
	if err != nil || maxAge < 0 || validatedAt.After(now.Add(time.Minute)) || now.Sub(validatedAt) > maxAge {
		return nil, StateStale
	}
	var entries []json.RawMessage
	if json.Unmarshal(state.Cookies, &entries) != nil || len(entries) == 0 {
		return nil, CookiesMissing
	}
	cookies := make([]cookie, 0, len(entries))
	for _, raw := range entries {
		item, err := readCookie(raw)
		if err != nil {
			return nil, err
		}
		if item.Expires != nil && *item.Expires != -1 && *item.Expires <= float64(now.UnixMilli())/1000 {
			continue
		}
		cookies = append(cookies, item)
	}
	if len(cookies) == 0 {
		return nil, CookiesExpired
	}
	return cookies, nil
}

func readCookie(raw []byte) (cookie, error) {
	var item cookie
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &item) != nil || json.Unmarshal(raw, &fields) != nil || item.Name == "" || !strings.HasPrefix(item.Path, "/") {
		return cookie{}, CookieInvalid
	}
	for _, key := range []string{"value", "domain", "expires", "httpOnly", "secure", "sameSite", "partitionKey"} {
		if bytes.Equal(fields[key], []byte("null")) {
			return cookie{}, CookieInvalid
		}
	}
	if fields["value"] == nil || fields["domain"] == nil ||
		(item.SameSite != nil && *item.SameSite != "Strict" && *item.SameSite != "Lax" && *item.SameSite != "None") {
		return cookie{}, CookieInvalid
	}
	domain := strings.TrimPrefix(item.Domain, ".")
	if domain != "yahoo.co.jp" && !strings.HasSuffix(domain, ".yahoo.co.jp") {
		return cookie{}, CookieDomain
	}
	return item, nil
}

func yahooLoginRedirect(raw string) bool {
	if raw == "" {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || !u.IsAbs() {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "login.yahoo.co.jp" || strings.HasSuffix(host, ".login.yahoo.co.jp")
}

func yahooMyPage(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Hostname(), "auctions.yahoo.co.jp") {
		return false
	}
	switch u.Path {
	case "/my", "/my/", "/user/jp/show/mystatus":
		return true
	default:
		return false
	}
}

// YahooHeartbeat checks the managed session without changing its snapshot.
func (c *Client) YahooHeartbeat(ctx context.Context) string {
	cookies, err := c.yahooCookies(time.Now())
	if err != nil {
		return err.Error()
	}
	if len(cookies) == 0 {
		return string(CookiesMissing)
	}
	response, err := c.render(ctx, htmlRequest{TargetURL: yahooURL + "/my", Cookies: &cookies, Retries: 1})
	if err != nil {
		return "FC_CHECK_FAILED"
	}
	if yahooLoginRedirect(response.URL) {
		return "FC_NEEDS_LOGIN"
	}
	doc, err := readHTML(response)
	if err != nil || !yahooMyPage(response.URL) {
		return "FC_CHECK_FAILED"
	}
	selector := c.yahoo.AuthenticatedSelector
	if selector == "" {
		selector = defaultYahooSelector
	}
	matcher, err := cascadia.Compile(selector)
	if err != nil || doc.FindMatcher(matcher).Length() == 0 {
		return "FC_AUTH_UNVERIFIED"
	}
	return "OK"
}
