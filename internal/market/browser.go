package market

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
)

const signatureAlgorithm = "ACS3-HMAC-SHA256"

type Cookie struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Domain string `json:"domain"`
	Path   string `json:"path"`
}

type PageRequest struct {
	URL                     string
	PageLoadedAssertion     string
	Cookies                 []Cookie
	MaxAssertionWaitSeconds int
	MaxRetries              int
	EvaluateScript          string
}

type Browser interface {
	Render(context.Context, PageRequest) (string, error)
}

type AliCloudBrowser struct {
	config config.AliCloud
	client *http.Client
	now    func() time.Time
}

func NewAliCloudBrowser(cfg config.AliCloud) *AliCloudBrowser {
	return &AliCloudBrowser{
		config: cfg,
		client: &http.Client{Timeout: 125 * time.Second},
		now:    time.Now,
	}
}

type browserPayload struct {
	TargetURL               string   `json:"target_url"`
	PageLoadedAssertion     string   `json:"page_loaded_assertion,omitempty"`
	Cookies                 []Cookie `json:"cookies,omitempty"`
	MaxAssertionWaitSeconds int      `json:"max_assertion_wait_seconds,omitempty"`
	MaxRetries              int      `json:"max_retries,omitempty"`
	EvaluateScript          string   `json:"evaluate_script,omitempty"`
}

type browserResponse struct {
	Success bool   `json:"success"`
	Content string `json:"content"`
	Error   string `json:"error"`
}

func (b *AliCloudBrowser) Render(ctx context.Context, request PageRequest) (string, error) {
	if b.config.AccessKeyID == "" || b.config.AccessKeySecret == "" || b.config.URL == "" {
		return "", fmt.Errorf("AliCloud browser configuration is missing")
	}
	endpoint, err := url.Parse(b.config.URL)
	if err != nil {
		return "", fmt.Errorf("parse AliCloud endpoint: %w", err)
	}
	payload, err := json.Marshal(browserPayload{
		TargetURL: request.URL, PageLoadedAssertion: request.PageLoadedAssertion,
		Cookies: request.Cookies, MaxAssertionWaitSeconds: request.MaxAssertionWaitSeconds,
		MaxRetries: request.MaxRetries, EvaluateScript: request.EvaluateScript,
	})
	if err != nil {
		return "", fmt.Errorf("encode browser request: %w", err)
	}
	date := b.now().UTC().Format("2006-01-02T15:04:05.000Z")
	headers := map[string]string{"content-type": "application/json", "x-acs-date": date}
	authorization := authorization("POST", endpoint, headers, b.config.AccessKeyID, b.config.AccessKeySecret)

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("create browser request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("X-Acs-Date", date)
	httpRequest.Header.Set("Authorization", authorization)
	httpRequest.Header.Set("User-Agent", "goods-hunter-go/1")
	response, err := b.client.Do(httpRequest)
	if err != nil {
		return "", fmt.Errorf("request browser renderer: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if err != nil {
		return "", fmt.Errorf("read browser response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("browser renderer returned %s: %s", response.Status, compactBody(raw))
	}
	var decoded browserResponse
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return "", fmt.Errorf("decode browser response: %w", err)
	}
	if !decoded.Success && decoded.Error != "" {
		return "", fmt.Errorf("browser renderer failed: %s", decoded.Error)
	}
	if decoded.Content == "" {
		return "", fmt.Errorf("browser renderer returned empty content")
	}
	return decoded.Content, nil
}

func authorization(method string, endpoint *url.URL, headers map[string]string, accessKeyID, accessKeySecret string) string {
	headerNames := make([]string, 0, len(headers))
	for name := range headers {
		lower := strings.ToLower(name)
		if strings.HasPrefix(lower, "x-acs-") || lower == "host" || lower == "content-type" {
			headerNames = append(headerNames, lower)
		}
	}
	sort.Strings(headerNames)
	var canonicalHeaders strings.Builder
	for _, name := range headerNames {
		canonicalHeaders.WriteString(name)
		canonicalHeaders.WriteByte(':')
		canonicalHeaders.WriteString(strings.TrimSpace(headers[name]))
		canonicalHeaders.WriteByte('\n')
	}
	path := endpoint.EscapedPath()
	if path == "" {
		path = "/"
	}
	path = strings.ReplaceAll(path, "+", "%20")
	path = strings.ReplaceAll(path, "*", "%2A")
	path = strings.ReplaceAll(path, "$", "%24")
	path = strings.ReplaceAll(path, "%7E", "~")
	canonicalRequest := strings.Join([]string{
		method,
		path,
		canonicalQuery(endpoint.Query()),
		canonicalHeaders.String(),
		strings.Join(headerNames, ";"),
		"", // Kept compatible with @alicloud/openapi-util's payload argument.
	}, "\n")
	requestDigest := sha256.Sum256([]byte(canonicalRequest))
	stringToSign := signatureAlgorithm + "\n" + hex.EncodeToString(requestDigest[:])
	mac := hmac.New(sha256.New, []byte(accessKeySecret))
	_, _ = mac.Write([]byte(stringToSign))
	signature := hex.EncodeToString(mac.Sum(nil))
	return fmt.Sprintf("%s Credential=%s,SignedHeaders=%s,Signature=%s", signatureAlgorithm, accessKeyID, strings.Join(headerNames, ";"), signature)
}

func canonicalQuery(values url.Values) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0)
	for _, key := range keys {
		items := values[key]
		if len(items) == 0 {
			parts = append(parts, rfc3986(key)+"=")
			continue
		}
		for _, value := range items {
			parts = append(parts, rfc3986(key)+"="+rfc3986(value))
		}
	}
	return strings.Join(parts, "&")
}

func rfc3986(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}

func compactBody(raw []byte) string {
	value := strings.Join(strings.Fields(string(raw)), " ")
	if len(value) > 512 {
		return value[:512] + "…"
	}
	return value
}
