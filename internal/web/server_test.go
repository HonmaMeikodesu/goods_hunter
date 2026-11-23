package web

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/HonmaMeikodesu/goods_hunter/internal/accounts"
	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
	"github.com/HonmaMeikodesu/goods_hunter/internal/hunter"
	"github.com/HonmaMeikodesu/goods_hunter/internal/market"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/notify"
	"github.com/HonmaMeikodesu/goods_hunter/internal/store"
)

func TestProxyEndpointMatchesCollectorPayload(t *testing.T) {
	key := make([]byte, 32)
	path := filepath.Join(t.TempDir(), "config.yaml")
	contents := []byte("proxies: []\n# 模拟配置\n")
	if err := os.WriteFile(path, contents, 0600); err != nil {
		t.Fatal(err)
	}
	server, err := New(config.Config{ProxyKey: key, ProxyPath: path}, nil, nil, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	server.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/config/proxy", nil))
	var payload proxyPayload
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &payload) != nil {
		t.Fatalf("bad proxy response: %s", rec.Body)
	}
	raw, _ := json.Marshal(payload.Data)
	expected := sha256.Sum256(raw)
	if payload.Digest != hex.EncodeToString(expected[:]) {
		t.Fatal("proxy payload digest differs from the companion collector")
	}
	block, _ := aes.NewCipher(key)
	aead, _ := cipher.NewGCM(block)
	nonce, _ := hex.DecodeString(payload.Data.IV)
	message, _ := hex.DecodeString(payload.Data.Message)
	plain, err := aead.Open(nil, nonce, message, nil)
	if err != nil || string(plain) != string(contents) {
		t.Fatalf("companion decryption failed: %v", err)
	}
}

type mailCapture struct {
	messages []notify.Message
}

func (m *mailCapture) Send(_ context.Context, message notify.Message) error {
	m.messages = append(m.messages, message)
	return nil
}

func TestLegacyAccountAndWatcherRoutes(t *testing.T) {
	dsn, redisURL := os.Getenv("GOODS_HUNTER_TEST_MYSQL_DSN"), os.Getenv("GOODS_HUNTER_TEST_REDIS_URL")
	if dsn == "" || redisURL == "" {
		t.Skip("set the integration test MySQL DSN and Redis URL")
	}
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(dsn, loc)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	raw, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	redisOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatal(err)
	}
	cache := redis.NewClient(redisOpts)
	defer cache.Close()
	const connectionCode = "local-fixture-mobile-code-with-enough-length"
	const origin = "https://watch.example.invalid"
	updatesDir := t.TempDir()
	releaseHash := strings.Repeat("a", 64)
	release, _ := json.Marshal(apkRelease{Version: "0.2.2", VersionCode: 4, RuntimeVersion: strings.Repeat("b", 40), SHA256: releaseHash, Bytes: 100})
	if err := os.WriteFile(filepath.Join(updatesDir, "latest.json"), release, 0600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Location: loc, PublicURL: origin, CookieKey: "fixture-cookie-key",
		Mobile: config.Mobile{Code: connectionCode, Origin: origin, UpdatesDir: updatesDir}}
	mail := &mailCapture{}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	auth := accounts.New(db, cache, mail, "operator@example.invalid", cfg.PublicURL)
	service := hunter.New(t.Context(), cfg, db, cache, market.New(cfg.FC, cfg.Yahoo), mail, logger)
	if err := service.Restore(t.Context()); err != nil {
		t.Fatal(err)
	}
	handler, err := New(cfg, auth, service, logger)
	if err != nil {
		t.Fatal(err)
	}
	legacyEmail, newEmail := model.NewID()+"@example.invalid", model.NewID()+"@example.invalid"
	defer raw.Exec("DELETE FROM `user` WHERE email IN (?,?)", legacyEmail, newEmail)
	password := model.NewID() + "&+=空格"
	digest := sha256.Sum256([]byte(password))
	if err := db.CreateUser(t.Context(), legacyEmail, hex.EncodeToString(digest[:])); err != nil {
		t.Fatal(err)
	}
	oldToken := model.NewID()
	if err := db.SaveSession(t.Context(), legacyEmail, oldToken, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	mac := (&server{cookieKey: cfg.CookieKey}).signCookie(oldToken)
	oldCookies := []*http.Cookie{{Name: loginCookie, Value: oldToken}, {Name: loginCookie + ".sig", Value: mac}}

	call := func(method, path, kind, body string, cookies []*http.Cookie, status int, code string, token ...string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, origin+path, strings.NewReader(body))
		r.Header.Set("Content-Type", kind)
		if len(token) > 0 {
			r.Header.Set("Authorization", "Bearer "+token[0])
		}
		for _, cookie := range cookies {
			r.AddCookie(cookie)
		}
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, r)
		if out.Code != status {
			t.Fatalf("%s %s: got HTTP %d, want %d (%s)", method, path, out.Code, status, out.Body)
		}
		if code != "" {
			var envelope response
			if err := json.Unmarshal(out.Body.Bytes(), &envelope); err != nil || envelope.Code != code {
				t.Fatalf("%s %s: response code = %q, want %q", method, path, envelope.Code, code)
			}
		}
		return out
	}
	call("GET", "/", "", "", nil, 200, "")
	call("GET", "/goods/listGoodsWatcher", "", "", nil, 302, "")
	call("GET", "/goods/listGoodsWatcher", "", "", oldCookies[:1], 400, "010102")
	call("GET", "/goods/listGoodsWatcher", "", "", oldCookies, 200, "200")
	form := url.Values{"email": {legacyEmail}, "password": {password}}.Encode()
	login := call("POST", "/login", "application/x-www-form-urlencoded", form, nil, 200, "200")
	newCookies := login.Result().Cookies()
	if len(newCookies) != 2 || !newCookies[0].HttpOnly || !newCookies[0].Secure {
		t.Fatal("legacy signed Login Cookie was not issued")
	}
	call("POST", "/goods/registerGoodsWatcher", "application/json", `{"type":"Xianyu","schedule":"*/15 * * * *","searchCondition":{"keyword":"巡检","maxPrice":12.345}}`, newCookies, 400, "040001")
	call("POST", "/goods/registerGoodsWatcher", "application/json", `{"type":"Xianyu","schedule":"*/15 * * * *","searchCondition":{"keyword":"巡检","maxPrice":12.30}}`, newCookies, 200, "200")
	out := call("GET", "/goods/listGoodsWatcher", "", "", newCookies, 200, "200")
	var list struct{ Data []watcherRow }
	if err := json.Unmarshal(out.Body.Bytes(), &list); err != nil || len(list.Data) != 1 ||
		list.Data[0].Type != model.Xianyu || !strings.Contains(list.Data[0].Condition, "12.3") {
		t.Fatalf("unexpected watcher list: %s", out.Body)
	}
	watcher := list.Data[0]

	newPassword := model.NewID()
	reg, _ := json.Marshal(credentials{Email: newEmail, Password: newPassword})
	call("POST", "/register", "application/json", string(reg), nil, 200, "200")
	matches := regexp.MustCompile(`code=([a-f0-9-]+)`).FindStringSubmatch(mail.messages[0].HTML)
	if len(matches) != 2 {
		t.Fatal("registration mail is missing a confirmation link")
	}
	call("GET", "/register/confirm?code="+matches[1], "", "", nil, 200, "200")
	call("GET", "/register/confirm?code="+matches[1], "", "", nil, 400, "030402")
	otherUser := call("POST", "/login/", "application/json", string(reg), nil, 200, "200").Result().Cookies()
	remove := "/goods/unregisterGoodsWatcher?type=Xianyu&id=" + watcher.ID
	update, _ := json.Marshal(watcherBody{ID: watcher.ID, Site: model.Xianyu, Schedule: "*/20 * * * *",
		SearchCondition: json.RawMessage(`{"keyword":"巡检","maxPrice":12.3}`)})
	call("POST", "/goods/updateGoodsWatcher", "application/json", string(update), otherUser, 400, "030503")
	call("GET", remove, "", "", otherUser, 400, "030503")
	call("POST", "/goods/updateGoodsWatcher", "application/json", string(update), newCookies, 200, "200")
	call("GET", remove, "", "", newCookies, 200, "200")
	call("GET", remove, "", "", newCookies, 400, "030502")

	const mobile = "/api/mobile/"
	call("GET", mobile+"state", "", "", oldCookies, 401, "010102")
	call("GET", mobile+"state", "", "", nil, 401, "010102", oldToken)
	call("GET", mobile+"tasks", "", "", oldCookies, 401, "010102")
	passwordOnly, _ := json.Marshal(credentials{Email: legacyEmail, Password: password})
	call("POST", mobile+"login", "application/json", string(passwordOnly), nil, 403, "040003")
	loginBody, _ := json.Marshal(map[string]string{"email": legacyEmail, "password": password, "connectionCode": connectionCode})
	loggedIn := call("POST", mobile+"login", "application/json", string(loginBody), nil, 200, "200")
	var session struct{ Data struct{ Token string } }
	if err := json.Unmarshal(loggedIn.Body.Bytes(), &session); err != nil || session.Data.Token == "" {
		t.Fatal("mobile login did not return a session token")
	}
	token := session.Data.Token
	call("POST", mobile+"scan", "application/json", `{}`, nil, 400, "040002", token)
	call("POST", mobile+"mode", "application/json", `{"active":true}`, nil, 200, "200", token)
	call("POST", mobile+"scan", "application/json", `{"site":"Surveillance"}`, nil, 400, "040001", token)
	call("POST", mobile+"scan", "application/json", `{}`, nil, 200, "200", token)
	state := call("GET", mobile+"state", "", "", nil, 200, "200", token)
	if state.Header().Get("Cache-Control") != "no-store" || !strings.Contains(state.Body.String(), `"active":true`) {
		t.Fatal("mobile mode was not saved or the response allows caching")
	}
	for _, task := range []model.Watcher{
		{Site: model.Surugaya, Owner: legacyEmail, Condition: `{"keyword":"限定 版","adultMode":true,"adultOnly":true}`},
		{Site: model.Surugaya, Owner: legacyEmail, Condition: `{"keyword":"通常版"}`},
		{Site: model.Xianyu, Owner: newEmail, Condition: `{"keyword":"other user's keyword"}`},
		{Site: model.Surveillance, Owner: legacyEmail, Condition: `{"type":"mercari","goodId":"m123"}`},
	} {
		task.ID, task.Schedule = model.NewID(), "0 0 31 12 *"
		if err := db.CreateWatcher(t.Context(), task); err != nil {
			t.Fatal(err)
		}
	}
	tasks := call("GET", mobile+"tasks", "", "", nil, 200, "200", token)
	var groups struct{ Data []mobileSiteTasks }
	if err := json.Unmarshal(tasks.Body.Bytes(), &groups); err != nil || tasks.Header().Get("Cache-Control") != "no-store" ||
		len(groups.Data) != 1 || groups.Data[0].Site != model.Surugaya || !groups.Data[0].AdultModeSupported || len(groups.Data[0].Tasks) != 2 {
		t.Fatalf("unexpected mobile tasks: %s", tasks.Body)
	}
	for _, task := range groups.Data[0].Tasks {
		adult := task.Keyword == "限定 版"
		link, err := url.Parse(task.SearchURL)
		if err != nil || task.ID == "" || (!adult && task.Keyword != "通常版") || task.AdultMode != adult || task.AdultOnly != adult ||
			link.Host != "www.suruga-ya.jp" || link.Query().Get("search_word") != task.Keyword || (link.Query().Get("adult_s") == "3") != adult {
			t.Fatalf("unexpected search task: %+v", task)
		}
	}
	call("GET", mobile+"products", "", "", nil, 200, "200", token)
	grantPath := updatePath + "apk/" + releaseHash
	granted := call("GET", grantPath, "", "", nil, 200, "", token)
	var grant apkGrant
	if err := json.Unmarshal(granted.Body.Bytes(), &grant); err != nil || grant.SHA256 != releaseHash || grant.Bytes != 100 ||
		!strings.HasPrefix(grant.DownloadURL, origin+updatePath+"apks/"+releaseHash+"?") {
		t.Fatal("mobile session could not authorize its APK download")
	}
	call("POST", mobile+"logout", "application/json", `{}`, nil, 200, "200", token)
	call("GET", mobile+"products", "", "", nil, 401, "010102", token)
	call("GET", grantPath, "", "", nil, 401, "", token)
}
