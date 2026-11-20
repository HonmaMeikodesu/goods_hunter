package market

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestManagedYahooSessionKeepsScopeAndRejectsStaleState(t *testing.T) {
	dir := t.TempDir()
	c := &Client{}
	c.yahoo.SessionFile = filepath.Join(dir, "session.json")
	c.yahoo.LegacyFile = filepath.Join(dir, "yahoo.json")
	if err := os.WriteFile(c.yahoo.LegacyFile, []byte("old=value"), 0600); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := c.yahooCookies(now); err != StateUnreadable {
		t.Fatalf("missing managed file fell back to old cookies: %v", err)
	}
	state := map[string]any{
		"version": 1, "status": "ready", "validatedAt": now.Format(time.RFC3339),
		"cookies": []map[string]any{
			{"name": "sid", "value": "fixture", "domain": "auctions.yahoo.co.jp", "path": "/my",
				"expires": -1, "secure": true, "httpOnly": false, "sameSite": "Lax"},
			{"name": "expired", "value": "fixture", "domain": ".yahoo.co.jp", "path": "/", "expires": now.Unix() - 30},
		},
	}
	save := func() {
		t.Helper()
		raw, _ := json.Marshal(state)
		if err := os.WriteFile(c.yahoo.SessionFile, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	save()
	cookies, err := c.yahooCookies(now)
	if err != nil || len(cookies) != 1 || cookies[0].Domain != "auctions.yahoo.co.jp" || cookies[0].Path != "/my" ||
		cookies[0].HTTPOnly == nil || *cookies[0].HTTPOnly || cookies[0].Secure == nil || !*cookies[0].Secure {
		t.Fatalf("scope or expiry handling changed (%v)", err)
	}
	if _, err := c.yahooCookies(now.Add(7 * time.Hour)); err != StateStale {
		t.Fatalf("stale state returned %v", err)
	}
	state["status"] = "needs_login"
	save()
	if _, err := c.yahooCookies(now); FailureOf(err) != LoginRequired {
		t.Fatalf("managed login requirement returned %v", err)
	}
	state["status"] = "ready"
	state["cookies"].([]map[string]any)[0]["domain"] = "other.test"
	save()
	if _, err := c.yahooCookies(now); err != CookieDomain {
		t.Fatalf("unrelated domain returned %v", err)
	}
}

func TestYahooHeartbeatRequiresPersonalPageAndAuthenticationMarker(t *testing.T) {
	target := "https://auctions.yahoo.co.jp/my"
	body := `<main><a href="/my/bidding">入札中</a></main>`
	c := fakeFC(t, func(r *http.Request) (int, any) {
		var request htmlRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.TargetURL != "https://auctions.yahoo.co.jp/my" || request.Cookies == nil || len(*request.Cookies) != 1 ||
			request.Assertion != "" || request.Retries != 1 {
			t.Fatalf("unexpected heartbeat request")
		}
		return 200, map[string]any{"success": true, "url": target, "content": body}
	})
	c.yahoo.LegacyFile = filepath.Join(t.TempDir(), "yahoo.json")
	if err := os.WriteFile(c.yahoo.LegacyFile, []byte("session=fixture-value"), 0600); err != nil {
		t.Fatal(err)
	}
	if reason := c.YahooHeartbeat(t.Context()); reason != "OK" {
		t.Fatalf("logged-in response returned %s", reason)
	}
	body = "<main>Not yet ready</main>"
	if reason := c.YahooHeartbeat(t.Context()); reason != "FC_AUTH_UNVERIFIED" {
		t.Fatalf("anonymous page returned %s", reason)
	}
	target = "https://login.yahoo.co.jp/config/login"
	if reason := c.YahooHeartbeat(t.Context()); reason != "FC_NEEDS_LOGIN" {
		t.Fatalf("login redirect returned %s", reason)
	}
}
