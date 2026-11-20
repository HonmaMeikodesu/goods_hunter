package market

import (
	"encoding/json"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode"

	"github.com/PuerkitoBio/goquery"
	"golang.org/x/text/unicode/norm"
)

type pageRules struct {
	QueryKeys     []string          `json:"queryKeys"`
	QueryDefaults map[string]string `json:"queryDefaults,omitempty"`
	ItemSelector  string            `json:"itemSelector"`
	EmptySelector string            `json:"emptySelector"`
	EmptyTexts    []string          `json:"emptyTexts"`
}

const hidden = `script, style, template, noscript, [hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"]`

var challengeTitle = regexp.MustCompile(`(?i)^(just a moment|attention required)\b`)

func searchCards(response htmlResponse, target string, rules pageRules) (*goquery.Selection, error) {
	doc, err := readHTML(response)
	if err != nil {
		return nil, err
	}
	if !sameSearch(target, response.URL, rules) {
		return nil, TargetMismatch
	}
	notices := make([]string, 0, len(rules.EmptyTexts))
	for _, text := range rules.EmptyTexts {
		notices = append(notices, normalizeNotice(text))
	}
	empty := doc.Find(rules.EmptySelector).FilterFunction(func(_ int, node *goquery.Selection) bool {
		return node.Closest(hidden).Length() == 0 && node.Closest(rules.ItemSelector).Length() == 0 &&
			slices.Contains(notices, normalizeNotice(node.Text()))
	}).Length() > 0

	cards := doc.Find(rules.ItemSelector).FilterFunction(func(_ int, node *goquery.Selection) bool {
		return node.Closest(hidden).Length() == 0
	})
	state := "items"
	if empty {
		state = "empty"
		cards = cards.Slice(0, 0)
	} else if cards.Length() == 0 {
		return nil, UnverifiedResults
	}
	if len(response.ResultState) > 0 {
		var reported string
		if json.Unmarshal(response.ResultState, &reported) != nil || reported != state {
			return nil, InvalidResponse
		}
	}
	return cards, nil
}

func readHTML(response htmlResponse) (*goquery.Document, error) {
	if response.Success == nil {
		return nil, InvalidResponse
	}
	if !*response.Success {
		return nil, fetchFailure(response)
	}
	if strings.TrimSpace(response.Content) == "" {
		return nil, EmptyContent
	}
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(response.Content))
	if err != nil {
		return nil, InvalidResponse
	}
	if challengeTitle.MatchString(strings.TrimSpace(doc.Find("title").First().Text())) ||
		doc.Find("#challenge-form, #cf-challenge-running, #cf-please-wait").Length() > 0 {
		return nil, Cloudflare
	}
	return doc, nil
}

func sameSearch(target, final string, rules pageRules) bool {
	expected, err := url.Parse(target)
	if err != nil {
		return false
	}
	actual, err := url.Parse(final)
	if err != nil || expected.Scheme != actual.Scheme || !strings.EqualFold(expected.Hostname(), actual.Hostname()) ||
		port(expected) != port(actual) || strings.TrimRight(expected.EscapedPath(), "/") != strings.TrimRight(actual.EscapedPath(), "/") {
		return false
	}
	expectedQuery := expected.Query()
	actualQuery := actual.Query()
	for _, key := range rules.QueryKeys {
		next, exists := actualQuery[key]
		if len(next) > 1 {
			return false
		}
		want := rules.QueryDefaults[key]
		if expectedQuery.Has(key) {
			want = expectedQuery.Get(key)
		}
		got := rules.QueryDefaults[key]
		if exists {
			got = next[0]
		}
		if want != got {
			return false
		}
	}
	return true
}

func port(u *url.URL) string {
	if u.Port() != "" {
		return u.Port()
	}
	if u.Scheme == "https" {
		return "443"
	}
	return "80"
}

func normalizeNotice(value string) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || r == '\ufeff' {
			return -1
		}
		return r
	}, norm.NFKC.String(value))
	return strings.TrimRight(value, "。.")
}

func fetchFailure(response htmlResponse) Failure {
	if code := knownFailure(response.Code); code != "" {
		return code
	}
	switch {
	case strings.Contains(response.Error, "net::ERR_CONNECTION_CLOSED"):
		return ConnectionClosed
	case strings.Contains(response.Error, "net::ERR_CONNECTION_RESET"):
		return ConnectionReset
	case (response.Cloudflare != nil && *response.Cloudflare) || strings.Contains(strings.ToLower(response.Error), "cloudflare"):
		return Cloudflare
	case strings.Contains(strings.ToLower(response.Error), "timeout") || strings.Contains(response.Error, "net::ERR_TIMED_OUT"):
		return FetchTimeout
	default:
		return FetchFailed
	}
}
