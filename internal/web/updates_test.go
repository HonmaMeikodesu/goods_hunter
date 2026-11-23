package web

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
)

func TestMobileUpdateDistribution(t *testing.T) {
	const origin = "https://goods.example.test"
	const code = "integration-test-connection-code-only"
	dir := t.TempDir()
	file := []byte("APK fixture")
	digest := sha256.Sum256(file)
	hash := hex.EncodeToString(digest[:])
	runtime := strings.Repeat("a", 40)
	manifest := `{"runtimeVersion":"` + runtime + `"}`
	signature := base64.StdEncoding.EncodeToString(make([]byte, 256))
	fixtures := map[string]any{
		"latest.json":                    apkRelease{Version: "0.2.0", VersionCode: 2, RuntimeVersion: runtime, SHA256: hash, Bytes: int64(len(file))},
		"manifests/" + runtime + ".json": map[string]string{"manifest": manifest, "signature": signature},
		"assets/" + hash:                 string(file),
		"apks/" + hash + ".apk":          string(file),
	}
	for name, value := range fixtures {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		var data []byte
		if raw, ok := value.(string); ok {
			data = []byte(raw)
		} else {
			data, _ = json.Marshal(value)
		}
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	settings := config.Mobile{Origin: origin, Code: code, UpdatesDir: dir}
	handler, err := New(config.Config{Mobile: settings}, nil, nil, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	serve := func(request *http.Request, status int) *httptest.ResponseRecorder {
		t.Helper()
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, request)
		if out.Code != status {
			t.Fatalf("%s %s: HTTP %d, want %d", request.Method, request.URL.Path, out.Code, status)
		}
		return out
	}
	latest := serve(httptest.NewRequest("GET", origin+updatePath+"latest", nil), 200)
	if !strings.Contains(latest.Body.String(), updatePath+"apk/"+hash) || strings.Contains(latest.Body.String(), "signature=") {
		t.Fatal("latest APK metadata leaked a grant or omitted its grant endpoint")
	}
	serve(httptest.NewRequest("GET", origin+updatePath+"apk/"+hash, nil), 401)
	serve(httptest.NewRequest("GET", origin+updatePath+"apks/"+hash, nil), 403)
	post := func(secret string) *http.Request {
		form := url.Values{"connectionCode": {secret}}
		req := httptest.NewRequest("POST", origin+updatePath+"download", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		return req
	}
	serve(post("wrong"), 403)
	grant := serve(post(code), 303).Header().Get("Location")
	fileResponse := serve(httptest.NewRequest("GET", grant, nil), 200)
	if fileResponse.Body.String() != string(file) || fileResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("private APK was changed or cacheable")
	}
	serve(httptest.NewRequest("GET", grant+"0", nil), 403)
	expired, err := url.Parse(grant)
	if err != nil {
		t.Fatal(err)
	}
	old := strconv.FormatInt(time.Now().Add(-time.Second).UnixMilli(), 10)
	query := expired.Query()
	query.Set("expires", old)
	query.Set("signature", hex.EncodeToString((&server{mobile: settings}).grantSignature(hash, old)))
	expired.RawQuery = query.Encode()
	serve(httptest.NewRequest("GET", expired.String(), nil), 403)

	manifestRequest := func(version, accept string) *http.Request {
		r := httptest.NewRequest("GET", origin+updatePath+"manifest", nil)
		r.Header.Set("Expo-Protocol-Version", "1")
		r.Header.Set("Expo-Platform", "android")
		r.Header.Set("Expo-Runtime-Version", version)
		r.Header.Set("Accept", accept)
		return r
	}
	serve(manifestRequest(strings.Repeat("b", 40), "multipart/mixed"), 204)
	out := serve(manifestRequest(runtime, "multipart/mixed"), 200)
	_, mimeParams, err := mime.ParseMediaType(out.Header().Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	part, err := multipart.NewReader(out.Body, mimeParams["boundary"]).NextPart()
	if err != nil || !strings.Contains(part.Header.Get("Expo-Signature"), signature) {
		t.Fatal("multipart manifest omitted its signature")
	}
	serve(httptest.NewRequest("GET", origin+updatePath+"assets/"+hash, nil), 200)
	plain := httptest.NewRequest("POST", "http://goods.example.test/api/mobile/login", strings.NewReader("{}"))
	plain.Header.Set("X-Forwarded-Proto", "https")
	serve(plain, http.StatusUpgradeRequired)
	proxied := httptest.NewRequest("GET", "http://goods.example.test"+updatePath+"latest", nil)
	proxied.RemoteAddr = "127.0.0.1:1443"
	proxied.Header.Set("X-Forwarded-Proto", "https")
	serve(proxied, 200)
}
