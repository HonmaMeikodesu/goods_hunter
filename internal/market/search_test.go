package market

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func fakeFC(t *testing.T, serve func(*http.Request) (int, any)) *Client {
	t.Helper()
	fc := config.FC{AccessKeyID: "test-key", AccessKeySecret: "test-secret", URL: "https://fc.test/direct",
		YahooFleamarketURL: "https://fc.test/flea/search", XianyuURL: "https://fc.test/xianyu/search"}
	c := New(fc, config.Yahoo{})
	c.http.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodPost || !strings.HasPrefix(r.Header.Get("Authorization"), "ACS3-HMAC-SHA256 Credential=test-key,") {
			t.Fatalf("unexpected FC request %s %s", r.Method, r.URL)
		}
		defer r.Body.Close()
		status, result := serve(r)
		raw, err := json.Marshal(result)
		if err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
	})
	return c
}

func condition(t *testing.T, site model.Site, schema string) model.Condition {
	t.Helper()
	value, err := model.ReadCondition(site, schema)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func TestAuthorizationMatchesAliCloudUtility(t *testing.T) {
	target, err := url.Parse("https://example.aliyuncs.com/2016-08-15/proxy/invokes/$LATEST?qualifier=LATEST&x=a%20b")
	if err != nil {
		t.Fatal(err)
	}
	actual := authorization(target, "2026-08-23T00:00:00.000Z", "test-key", "test-secret")
	want := "ACS3-HMAC-SHA256 Credential=test-key,SignedHeaders=content-type;x-acs-date,Signature=e526e825fa7f418c98d130e72ce4f4a0e8f3ef8f0e06f0c8083da00518c8bdaf"
	if actual != want {
		t.Fatalf("signature = %q, want %q", actual, want)
	}
}

func TestSearchHTMLFixtures(t *testing.T) {
	for _, tc := range []struct {
		name, fixture string
		site          model.Site
		id, price     string
		count         int
	}{
		{"mercari", "mercari-new.html", model.Mercari, "m37885764030", "16250", 2},
		{"yahoo-opensearch", "yahoo-new.html", model.Yahoo, "x1247466554", "", 4},
		{"yahoo-legacy", "yahoo-old.html", model.Yahoo, "x1247466554", "", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join("..", "..", "test", "fixtures", "search", tc.fixture))
			if err != nil {
				t.Fatal(err)
			}
			var offsets []string
			client := fakeFC(t, func(r *http.Request) (int, any) {
				var payload htmlRequest
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Fatal(err)
				}
				target, _ := url.Parse(payload.TargetURL)
				if tc.site == model.Yahoo {
					offsets = append(offsets, target.Query().Get("b"))
					if target.Query().Get("auccat") != "26084" {
						t.Errorf("missing Yahoo category in %s", target)
					}
				}
				if payload.Search == nil || payload.Assertion == "" || payload.Retries == 0 {
					t.Fatalf("incomplete HTML FC request: %+v", payload)
				}
				return 200, map[string]any{"success": true, "content": string(raw) + string(raw), "url": payload.TargetURL}
			})
			items, err := client.Search(t.Context(), tc.site, condition(t, tc.site, `{"keyword":"本間芽衣子","epoch":2,"category":"26084"}`))
			if err != nil || len(items) != tc.count {
				t.Fatalf("expected %d goods, got %d (%v)", tc.count, len(items), err)
			}
			if items[0].ID != tc.id || items[0].Price != tc.price {
				t.Fatalf("unexpected first listing %+v", items[0])
			}
			if tc.site == model.Yahoo && (!reflect.DeepEqual(offsets, []string{"1", "51"}) || items[0].Amount != 500) {
				t.Fatalf("Yahoo price/pagination mismatch: %+v, offsets %v", items[0], offsets)
			}
			if tc.site == model.Mercari && items[1].Status != "STATUS_SOLD_OUT" {
				t.Fatal("sold listing lost its status")
			}
		})
	}
}

func TestSearchPageEvidence(t *testing.T) {
	const target = "https://jp.mercari.com/search?keyword=a+b&sort=created_time&order=desc"
	const empty = "<main><p>該当する商品が見つかりませんでした。</p></main>"
	success := true
	for _, tc := range []struct {
		name, html, final, state string
		want                     error
	}{
		{"verified-empty", empty, target, `"empty"`, nil},
		{"hidden-empty", "<div hidden>" + empty + "</div>", target, "", UnverifiedResults},
		{"script-empty", "<script>" + empty + "</script>", target, "", UnverifiedResults},
		{"unfinished", "<main>Loading…</main>", target, "", UnverifiedResults},
		{"challenge", "<title>Just a moment...</title>", target, "", Cloudflare},
		{"stale", empty, strings.Replace(target, "a+b", "different", 1), "", TargetMismatch},
		{"duplicate-key", empty, target + "&keyword=a+b", "", TargetMismatch},
		{"contradiction", empty, target, `"items"`, InvalidResponse},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cards, err := searchCards(htmlResponse{Success: &success, Content: tc.html, URL: tc.final, ResultState: json.RawMessage(tc.state)},
				target, mercariRules)
			if err != tc.want || (err == nil && cards.Length() != 0) {
				t.Fatalf("search state = %v, want %v", err, tc.want)
			}
		})
	}

	const surugaya = "https://www.suruga-ya.jp/search?search_word=a"
	cards, err := searchCards(htmlResponse{Success: &success, URL: surugaya,
		Content: `<div id="search_header"><div class="hit">該当件数：０件</div></div>`}, surugaya, surugayaRules)
	if err != nil || cards.Length() != 0 {
		t.Fatalf("Surugaya empty state = %v", err)
	}
}

func TestFleamarketChecksEveryPageAndBuildsTrustedLinks(t *testing.T) {
	var pages []int
	stale := false
	c := fakeFC(t, func(r *http.Request) (int, any) {
		var input struct {
			Keyword    string
			Page       int
			OnSaleOnly bool
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.Keyword != "缶バッジ" ||
			!input.OnSaleOnly || r.URL.Path != "/flea/search" {
			t.Fatalf("bad flea-market request: %+v (%v)", input, err)
		}
		pages = append(pages, input.Page)
		reported := input.Page
		if stale && input.Page == 2 {
			reported = 1
		}
		item := func(id, name, status string, price int) map[string]any {
			return map[string]any{"id": id, "name": name, "status": status, "price": price,
				"itemUrl": "javascript:alert(1)", "thumbnailImageUrl": "https://example.test/image.jpg"}
		}
		items := []any{item("h/?", "缶バッジ 1", "OPEN", 500), item("sold", "sold", "SOLD", 500)}
		if input.Page == 2 {
			items = append(items, item("h2", "缶バッジ 2", "OPEN", 501), item("excluded", "まとめ売り", "OPEN", 500))
		}
		return 200, map[string]any{"success": true, "source": "yahooFleamarket", "keyword": input.Keyword,
			"page": reported, "offset": (input.Page - 1) * 100, "items": items, "totalResultsAvailable": 150}
	})
	filter := condition(t, model.YahooFleamarket, `{"keyword":" 缶バッジ ","epoch":2,"minPrice":100,"maxPrice":2000,"excludeKeywords":["まとめ売り"]}`)
	items, err := c.Search(t.Context(), model.YahooFleamarket, filter)
	if err != nil || !reflect.DeepEqual(pages, []int{1, 2}) || len(items) != 2 ||
		items[0].URL != "https://paypayfleamarket.yahoo.co.jp/item/h%2F%3F" || items[0].Image == "" {
		t.Fatalf("flea-market results = %+v, pages = %v, error = %v", items, pages, err)
	}
	stale = true
	if got, err := c.Search(t.Context(), model.YahooFleamarket, filter); err != InvalidResponse || len(got) != 0 {
		t.Fatalf("stale page produced %+v, error %v", got, err)
	}
}

func TestXianyuContractAndPriceFilters(t *testing.T) {
	badCurrency := false
	blocked := false
	c := fakeFC(t, func(r *http.Request) (int, any) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || len(payload) != 1 ||
			payload["keyword"] != "面码" || r.URL.Path != "/xianyu/search" {
			t.Fatalf("bad Xianyu request: %+v", payload)
		}
		if blocked {
			return 403, map[string]any{"code": "CHALLENGE_REQUIRED"}
		}
		item := func(id, title string, fen int) map[string]any {
			return map[string]any{"id": id, "name": title, "priceFen": fen, "publishedAt": nil,
				"thumbnailImageUrl": "https://img.alicdn.com/fixture.jpg", "itemUrl": "https://other.test/override"}
		}
		currency := "CNY"
		if badCurrency {
			currency = "JPY"
		}
		return 200, map[string]any{"success": true, "source": "xianyu", "keyword": "面码", "page": 1, "pageSize": 30,
			"sort": "newest", "currency": currency, "resultState": "items", "hasMore": false,
			"items": []any{item("123", "面码 手办", 1499), item("456", "面码 手办", 1500),
				item("789", "面码 手办 求购", 1400), item("987", "面码 徽章", 1400)}}
	})
	filter := condition(t, model.Xianyu, `{"keyword":"面码","maxPrice":14.99,"includeKeywords":[" 手办 "],"excludeKeywords":["求购"]}`)
	items, err := c.Search(t.Context(), model.Xianyu, filter)
	if err != nil || len(items) != 1 || items[0].Amount != 1499 || items[0].URL != "https://www.goofish.com/item?id=123" {
		t.Fatalf("Xianyu results = %+v, %v", items, err)
	}
	badCurrency = true
	if _, err := c.Search(t.Context(), model.Xianyu, filter); err != InvalidResponse {
		t.Fatalf("invalid currency returned %v", err)
	}
	blocked = true
	if _, err := c.Search(t.Context(), model.Xianyu, filter); FailureOf(err) != "CHALLENGE_REQUIRED" {
		t.Fatalf("FC challenge returned %v", err)
	}
}

func TestCollectorFixtureServer(t *testing.T) {
	base := os.Getenv("GOODS_HUNTER_TEST_FC_URL")
	if base == "" {
		t.Skip("set GOODS_HUNTER_TEST_FC_URL to run companion collector fixtures")
	}
	c := New(config.FC{URL: base, YahooFleamarketURL: os.Getenv("GOODS_HUNTER_TEST_FLEA_URL"),
		XianyuURL: os.Getenv("GOODS_HUNTER_TEST_XIANYU_URL"), AccessKeyID: "fixture", AccessKeySecret: "fixture"}, config.Yahoo{})
	for _, tc := range []struct {
		site    model.Site
		keyword string
		outcome Failure
	}{
		{model.Mercari, "mock-items", "VALID"},
		{model.Mercari, "mock-parse-error", InvalidItems},
		{model.Yahoo, "mock-items", "VALID"},
		{model.Surugaya, "mock-items", "VALID"},
		{model.Surugaya, "mock-shell", UnverifiedResults},
		{model.Mandarake, "mock-sold", "VALID"},
		{model.YahooFleamarket, "mock-items", "VALID"},
		{model.Xianyu, "mock-items", "VALID"},
		{model.Xianyu, "mock-challenge", "CHALLENGE_REQUIRED"},
	} {
		t.Run(string(tc.site)+"/"+tc.keyword, func(t *testing.T) {
			schema, _ := json.Marshal(map[string]string{"keyword": tc.keyword})
			_, err := c.Search(t.Context(), tc.site, condition(t, tc.site, string(schema)))
			if FailureOf(err) != tc.outcome {
				t.Fatalf("outcome = %v, want %v", err, tc.outcome)
			}
		})
	}
}
