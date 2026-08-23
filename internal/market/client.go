// Package market owns URL construction and HTML interpretation for all four
// supported marketplaces behind Search and Snapshot.
package market

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

const mercariEvaluateScript = `localStorage.setItem("userPreferenceCurrencyCode", '"JPY"')`

var surugayaCookies = []Cookie{
	{Name: "safe_search_option", Value: "3", Domain: "www.suruga-ya.jp", Path: "/"},
	{Name: "safe_search_expired", Value: "3", Domain: "www.suruga-ya.jp", Path: "/"},
}

var mandarakeCookies = []Cookie{
	{Name: "_ga", Value: "0", Domain: "order.mandarake.co.jp", Path: "/"},
	{Name: "_gat", Value: "0", Domain: "order.mandarake.co.jp", Path: "/"},
	{Name: "_gid", Value: "0", Domain: "order.mandarake.co.jp", Path: "/"},
	{Name: "mandarake_url", Value: "0", Domain: "order.mandarake.co.jp", Path: "/"},
	{Name: "tr_mndrk_user", Value: "0", Domain: "order.mandarake.co.jp", Path: "/"},
}

type Client struct {
	browser      Browser
	yahooCookies []Cookie
}

func NewClient(browser Browser, yahooCookie string) *Client {
	return &Client{browser: browser, yahooCookies: parseCookieHeader(yahooCookie, "auctions.yahoo.co.jp")}
}

func (c *Client) Search(ctx context.Context, site model.Site, condition model.SearchCondition) ([]model.Item, error) {
	if strings.TrimSpace(condition.Keyword) == "" {
		return nil, fmt.Errorf("search keyword is required")
	}
	switch site {
	case model.SiteMercari:
		return c.searchMercari(ctx, condition)
	case model.SiteYahoo:
		return c.searchYahoo(ctx, condition)
	case model.SiteSurugaya:
		return c.searchSurugaya(ctx, condition)
	case model.SiteMandarake:
		return c.searchMandarake(ctx, condition)
	default:
		return nil, fmt.Errorf("unsupported marketplace %q", site)
	}
}

func (c *Client) Snapshot(ctx context.Context, site model.Site, id string) (model.Snapshot, error) {
	if !site.Valid() || strings.TrimSpace(id) == "" {
		return model.Snapshot{}, fmt.Errorf("marketplace and item id are required")
	}
	request := PageRequest{MaxRetries: 3}
	switch site {
	case model.SiteMercari:
		request.URL = "https://jp.mercari.com/item/" + url.PathEscape(id)
		request.PageLoadedAssertion = `data-testid="price"`
		request.EvaluateScript = mercariEvaluateScript
	case model.SiteSurugaya:
		request.URL = "https://www.suruga-ya.jp/product/detail/" + url.PathEscape(id)
		request.PageLoadedAssertion = "price_group"
		request.Cookies = surugayaCookies
	case model.SiteYahoo:
		request.URL = "https://auctions.yahoo.co.jp/jp/auction/" + url.PathEscape(id)
		request.PageLoadedAssertion = "itemStatus"
		request.Cookies = c.yahooCookies
	case model.SiteMandarake:
		request.URL = "https://order.mandarake.co.jp/order/detailPage/item?itemCode=" + url.QueryEscape(id)
		request.PageLoadedAssertion = "在庫"
		request.Cookies = mandarakeCookies
	}
	raw, err := c.browser.Render(ctx, request)
	if err != nil {
		return model.Snapshot{}, err
	}
	return parseSnapshot(raw, site, id)
}

func (c *Client) searchMercari(ctx context.Context, condition model.SearchCondition) ([]model.Item, error) {
	target := "https://jp.mercari.com/search?keyword=" + url.QueryEscape(condition.Keyword) + "&order=desc&sort=created_time"
	raw, err := c.browser.Render(ctx, PageRequest{
		URL: target, PageLoadedAssertion: "merItemThumbnail", MaxRetries: 3, EvaluateScript: mercariEvaluateScript,
	})
	if err != nil {
		return nil, err
	}
	return parseMercariItems(raw)
}

func (c *Client) searchYahoo(ctx context.Context, condition model.SearchCondition) ([]model.Item, error) {
	pages := boundedPages(condition.Epoch)
	items := make([]model.Item, 0)
	for page := 0; page < pages; page++ {
		query := url.Values{
			"p": {condition.Keyword}, "va": {condition.Keyword}, "is_postage_mode": {"1"},
			"dest_pref_code": {"13"}, "exflg": {"1"}, "b": {strconv.Itoa(60*page + 1)},
			"n": {"60"}, "s1": {"new"}, "o1": {"d"}, "rc_ng": {"1"},
		}
		if condition.Category != "" {
			query.Set("auccat", condition.Category)
		}
		raw, err := c.browser.Render(ctx, PageRequest{
			URL:                 "https://auctions.yahoo.co.jp/search/search?" + query.Encode(),
			PageLoadedAssertion: "Result__body", Cookies: c.yahooCookies, MaxRetries: pages * 2,
		})
		if err != nil {
			return nil, err
		}
		parsed, err := parseYahooItems(raw)
		if err != nil {
			return nil, err
		}
		items = append(items, parsed...)
	}
	return items, nil
}

func (c *Client) searchSurugaya(ctx context.Context, condition model.SearchCondition) ([]model.Item, error) {
	pages := boundedPages(condition.Epoch)
	items := make([]model.Item, 0)
	for page := 1; page <= pages; page++ {
		query := url.Values{
			"category": {condition.Category}, "search_word": {condition.Keyword},
			"is_marketplace": {"0"}, "rankBy": {"modificationTime:descending"},
		}
		if condition.AdultMode && condition.AdultOnly {
			query.Set("adult_s", "3")
		}
		if page > 1 {
			query.Set("page", strconv.Itoa(page))
		}
		raw, err := c.browser.Render(ctx, PageRequest{
			URL:                 "https://www.suruga-ya.jp/search?" + query.Encode(),
			PageLoadedAssertion: "search_result", Cookies: surugayaCookies, MaxRetries: pages * 2,
		})
		if err != nil {
			return nil, err
		}
		parsed, err := parseSurugayaItems(raw)
		if err != nil {
			return nil, err
		}
		items = append(items, parsed...)
	}
	return items, nil
}

func (c *Client) searchMandarake(ctx context.Context, condition model.SearchCondition) ([]model.Item, error) {
	page := condition.Page
	if page < 1 {
		page = 1
	}
	if page > 1000 {
		page = 1000
	}
	target := "https://order.mandarake.co.jp/order/listPage/list?page=" + strconv.Itoa(page) + "&layout=0&keyword=" + url.QueryEscape(condition.Keyword) + "&deviceId=1"
	raw, err := c.browser.Render(ctx, PageRequest{
		URL: target, PageLoadedAssertion: "entry", Cookies: mandarakeCookies, MaxRetries: 3,
	})
	if err != nil {
		return nil, err
	}
	return parseMandarakeItems(raw)
}

func boundedPages(value int) int {
	if value < 1 {
		return 1
	}
	if value > 10 {
		return 10
	}
	return value
}

func parseCookieHeader(raw, domain string) []Cookie {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	result := make([]Cookie, 0)
	for _, part := range strings.Split(raw, ";") {
		pieces := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(pieces) != 2 || pieces[0] == "" {
			continue
		}
		result = append(result, Cookie{Name: pieces[0], Value: pieces[1], Domain: domain, Path: "/"})
	}
	return result
}
