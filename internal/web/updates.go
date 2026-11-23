package web

import (
	"crypto/hmac"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const updatePath = "/api/mobile/updates/"
const grantLifetime = 10 * time.Minute

var contentHash = regexp.MustCompile(`^[a-f0-9]{64}$`)
var runtimeID = regexp.MustCompile(`^[a-f0-9]{40,64}$`)
var versionID = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)

//go:embed download.html
var downloadHTML string

type apkRelease struct {
	Version          string `json:"version"`
	VersionCode      int    `json:"versionCode"`
	RuntimeVersion   string `json:"runtimeVersion"`
	SHA256           string `json:"sha256"`
	Bytes            int64  `json:"bytes"`
	Notes            string `json:"notes"`
	DownloadGrantURL string `json:"downloadGrantUrl,omitempty"`
}

type apkGrant struct {
	SHA256      string `json:"sha256"`
	Bytes       int64  `json:"bytes"`
	ExpiresAt   int64  `json:"expiresAt"`
	DownloadURL string `json:"downloadUrl"`
}

func (s *server) registerUpdateRoutes(mux *http.ServeMux) {
	for pattern, handler := range map[string]http.HandlerFunc{
		"GET " + updatePath + "latest":        s.updateLatest,
		"GET " + updatePath + "manifest":      s.updateManifest,
		"GET " + updatePath + "assets/{hash}": s.updateAsset,
		"GET " + updatePath + "download":      s.downloadPage,
		"POST " + updatePath + "download":     s.downloadFromBrowser,
		"GET " + updatePath + "apk/{hash}":    s.updateGrant,
		"GET " + updatePath + "apks/{hash}":   s.serveAPK,
	} {
		mux.HandleFunc(pattern, s.mobileHTTPS(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			if s.mobile.UpdatesDir == "" || s.mobile.Origin == "" || s.mobile.Code == "" {
				http.NotFound(w, r)
				return
			}
			handler(w, r)
		}))
	}
}

func (s *server) latestAPK() (apkRelease, error) {
	var release apkRelease
	data, err := os.ReadFile(filepath.Join(s.mobile.UpdatesDir, "latest.json"))
	if err != nil {
		return release, err
	}
	if json.Unmarshal(data, &release) != nil || !versionID.MatchString(release.Version) ||
		!runtimeID.MatchString(release.RuntimeVersion) || !contentHash.MatchString(release.SHA256) ||
		release.Bytes <= 0 || release.Bytes > 200<<20 || release.VersionCode <= 0 {
		return release, fmt.Errorf("invalid APK release metadata")
	}
	release.DownloadGrantURL = s.mobile.Origin + updatePath + "apk/" + release.SHA256
	return release, nil
}

func (s *server) updateLatest(w http.ResponseWriter, r *http.Request) {
	release, err := s.latestAPK()
	if os.IsNotExist(err) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		s.respond(w, r, nil, err)
		return
	}
	writeJSON(w, http.StatusOK, release)
}

func (s *server) updateManifest(w http.ResponseWriter, r *http.Request) {
	for name, value := range map[string]string{
		"expo-protocol-version": "1", "expo-sfv-version": "0", "expo-manifest-filters": "",
		"expo-server-defined-headers": "", "Vary": "expo-platform, expo-runtime-version, Accept",
	} {
		w.Header().Set(name, value)
	}
	runtime := r.Header.Get("Expo-Runtime-Version")
	if r.Header.Get("Expo-Protocol-Version") != "1" {
		w.WriteHeader(http.StatusNotAcceptable)
		return
	}
	if r.Header.Get("Expo-Platform") != "android" || !runtimeID.MatchString(runtime) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	data, err := os.ReadFile(filepath.Join(s.mobile.UpdatesDir, "manifests", runtime+".json"))
	if os.IsNotExist(err) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		s.respond(w, r, nil, err)
		return
	}
	var envelope struct{ Manifest, Signature string }
	var manifest struct{ RuntimeVersion string }
	if json.Unmarshal(data, &envelope) != nil || json.Unmarshal([]byte(envelope.Manifest), &manifest) != nil || manifest.RuntimeVersion != runtime {
		s.respond(w, r, nil, fmt.Errorf("invalid update manifest"))
		return
	}
	if signature, err := base64.StdEncoding.DecodeString(envelope.Signature); err != nil || len(signature) != 256 {
		s.respond(w, r, nil, fmt.Errorf("invalid update signature"))
		return
	}
	signed := `sig="` + envelope.Signature + `", keyid="goods-hunter-root", alg="rsa-v1_5-sha256"`
	if strings.Contains(r.Header.Get("Accept"), "multipart/mixed") {
		writer := multipart.NewWriter(w)
		w.Header().Set("Content-Type", "multipart/mixed; boundary="+writer.Boundary())
		part, err := writer.CreatePart(textproto.MIMEHeader{
			"Content-Disposition": {`form-data; name="manifest"`},
			"Content-Type":        {"application/json"}, "Expo-Signature": {signed},
		})
		if err == nil {
			_, _ = part.Write([]byte(envelope.Manifest))
		}
		_ = writer.Close()
		return
	}
	w.Header().Set("Content-Type", "application/expo+json")
	w.Header().Set("expo-signature", signed)
	_, _ = w.Write([]byte(envelope.Manifest))
}

func (s *server) updateAsset(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	if !contentHash.MatchString(hash) {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(filepath.Join(s.mobile.UpdatesDir, "assets", hash))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeContent(w, r, hash, info.ModTime(), file)
}

func (s *server) grantSignature(hash, expires string) []byte {
	mac := hmac.New(sha256.New, []byte(s.mobile.Code))
	_, _ = fmt.Fprintf(mac, "goods-hunter-apk\x00%s:%s", hash, expires)
	return mac.Sum(nil)
}

func (s *server) issueAPKGrant(release apkRelease) apkGrant {
	expires := time.Now().Add(grantLifetime).UnixMilli()
	deadline := strconv.FormatInt(expires, 10)
	sig := hex.EncodeToString(s.grantSignature(release.SHA256, deadline))
	address := s.mobile.Origin + updatePath + "apks/" + release.SHA256 + "?expires=" + deadline + "&signature=" + sig
	return apkGrant{release.SHA256, release.Bytes, expires, address}
}

func (s *server) updateGrant(w http.ResponseWriter, r *http.Request) {
	if _, err := s.accounts.AuthenticateMobile(r.Context(), s.mobile.Code, mobileToken(r)); err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	release, err := s.latestAPK()
	if err != nil || r.PathValue("hash") != release.SHA256 {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, s.issueAPKGrant(release))
}

func (s *server) serveAPK(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	deadline := r.URL.Query().Get("expires")
	expires, timeErr := strconv.ParseInt(deadline, 10, 64)
	sig, sigErr := hex.DecodeString(r.URL.Query().Get("signature"))
	now := time.Now()
	if !contentHash.MatchString(hash) || timeErr != nil || sigErr != nil || expires <= now.UnixMilli() ||
		expires > now.Add(grantLifetime).UnixMilli() || !hmac.Equal(sig, s.grantSignature(hash, deadline)) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(grantLifetime))
	w.Header().Set("Content-Disposition", `attachment; filename="goods-hunter.apk"`)
	w.Header().Set("Content-Type", "application/vnd.android.package-archive")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.ServeFile(w, r, filepath.Join(s.mobile.UpdatesDir, "apks", hash+".apk"))
}

func (s *server) downloadPage(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
	_, _ = w.Write([]byte(downloadHTML))
}

func (s *server) downloadFromBrowser(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil || !s.validConnectionCode(r.PostForm.Get("connectionCode")) {
		http.Error(w, "连接码无效，请返回重试。", http.StatusForbidden)
		return
	}
	release, err := s.latestAPK()
	if err != nil {
		http.Error(w, "安装包暂未发布。", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, s.issueAPKGrant(release).DownloadURL, http.StatusSeeOther)
}
