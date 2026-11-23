package market

import (
	"context"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

const (
	mercariURL   = "https://jp.mercari.com"
	yahooURL     = "https://auctions.yahoo.co.jp"
	surugayaURL  = "https://www.suruga-ya.jp"
	mandarakeURL = "https://order.mandarake.co.jp"

	mercariJPY = `localStorage.setItem("userPreferenceCurrencyCode", '"JPY"')`
)

func (c *Client) Search(ctx context.Context, site model.Site, condition model.Condition) ([]model.Item, error) {
	if site == model.Xianyu {
		return c.xianyuSearch(ctx, condition)
	}
	if site == model.YahooFleamarket {
		return c.fleamarketSearch(ctx, condition)
	}

	var yahooCookies []cookie
	if site == model.Yahoo {
		var err error
		yahooCookies, err = c.yahooCookies(time.Now())
		if err != nil {
			return nil, err
		}
	}
	var items []model.Item
	for page := 1; page <= condition.Epoch; page++ {
		request, err := searchRequest(site, condition, page, yahooCookies)
		if err != nil {
			return nil, err
		}
		response, err := c.render(ctx, request)
		if err != nil {
			return nil, err
		}
		if site == model.Mercari && retryMercari(response) {
			timer := time.NewTimer(30 * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, ctx.Err()
			case <-timer.C:
			}
			request.Retries = 1
			response, err = c.render(ctx, request)
			if err != nil {
				return nil, err
			}
		}
		if site == model.Yahoo && yahooLoginRedirect(response.URL) {
			return nil, LoginRequired
		}
		cards, err := searchCards(response, request.TargetURL, *request.Search)
		if err != nil {
			return nil, err
		}
		if cards.Length() == 0 {
			continue
		}
		var results []model.Item
		switch site {
		case model.Mercari:
			results, err = parseMercari(cards)
		case model.Yahoo:
			results, err = parseYahoo(cards)
		case model.Surugaya:
			results, err = parseSurugaya(cards)
		case model.Mandarake:
			results, err = parseMandarake(cards)
		}
		if err != nil {
			return nil, err
		}
		items = append(items, results...)
	}
	return deduplicate(items), nil
}

// SearchURL returns the marketplace search page that can be opened in a browser.
func SearchURL(site model.Site, condition model.Condition) string {
	switch site {
	case model.YahooFleamarket:
		query := url.Values{"withSpeller": {"0"}, "sort": {"openTime"}, "order": {"desc"}, "open": {"1"}, "page": {"1"}}
		return fleaURL + "/search/" + url.PathEscape(condition.Keyword) + "?" + query.Encode()
	case model.Xianyu:
		query := url.Values{"q": {condition.Keyword}}
		return xianyuURL + "/search?" + query.Encode()
	default:
		request, _ := searchRequest(site, condition, 1, nil)
		return request.TargetURL
	}
}

// YahooAdultCategory classifies the selected category, using verified Yahoo category IDs.
func YahooAdultCategory(category string) (includesAdult, adultOnly bool) {
	switch category {
	case "26084": // その他 contains the adult branch and ordinary categories.
		return true, false
	case "26146", "26156", "2084006445", "2084297892": // アダルト, books, goods, and the body pillow subcategory.
		return true, true
	default:
		return false, false
	}
}

func searchRequest(site model.Site, condition model.Condition, page int, yahooCookies []cookie) (htmlRequest, error) {
	switch site {
	case model.Mercari:
		query := url.Values{"keyword": {condition.Keyword}, "order": {"desc"}, "sort": {"created_time"}}
		return htmlRequest{TargetURL: mercariURL + "/search?" + query.Encode(), Assertion: `data-testid="thumbnail-link"`,
			Cookies: &[]cookie{}, WaitSeconds: 30, Retries: 2, Evaluate: mercariJPY, Search: &mercariRules}, nil
	case model.Yahoo:
		query := url.Values{
			"p": {condition.Keyword}, "va": {condition.Keyword}, "is_postage_mode": {"1"},
			"dest_pref_code": {"13"}, "exflg": {"1"}, "b": {strconv.Itoa(50*(page-1) + 1)},
			"n": {"50"}, "s1": {"new"}, "o1": {"d"}, "rc_ng": {"1"},
		}
		if condition.Category != "" {
			query.Set("auccat", condition.Category)
		}
		request := htmlRequest{TargetURL: yahooURL + "/search/search?" + query.Encode(), Assertion: "/jp/auction/",
			WaitSeconds: 30, Retries: 2 * condition.Epoch, Search: &yahooRules}
		if len(yahooCookies) > 0 {
			request.Cookies = &yahooCookies
		}
		return request, nil
	case model.Surugaya:
		query := url.Values{"category": {condition.Category}, "search_word": {condition.Keyword},
			"is_marketplace": {"0"}, "rankBy": {"modificationTime:descending"}}
		if page > 1 {
			query.Set("page", strconv.Itoa(page))
		}
		if condition.AdultMode && condition.AdultOnly {
			query.Set("adult_s", "3")
		}
		return htmlRequest{TargetURL: surugayaURL + "/search?" + query.Encode(), Assertion: "search_result",
			Cookies: &surugayaCookies, Retries: 2 * condition.Epoch, Search: &surugayaRules}, nil
	case model.Mandarake:
		query := url.Values{"page": {strconv.Itoa(condition.Page)}, "keyword": {condition.Keyword},
			"layout": {"0"}, "deviceId": {"1"}}
		return htmlRequest{TargetURL: mandarakeURL + "/order/listPage/list?" + query.Encode(), Assertion: "entry",
			Cookies: &mandarakeCookies, Retries: 3, Search: &mandarakeRules}, nil
	default:
		return htmlRequest{}, InvalidRequest
	}
}

func retryMercari(response htmlResponse) bool {
	if response.Success == nil || *response.Success || response.Cloudflare == nil || *response.Cloudflare {
		return false
	}
	message, ok := strings.CutPrefix(response.Error, "Page.goto:")
	message = strings.TrimSpace(message)
	return ok && (strings.HasPrefix(message, "net::ERR_CONNECTION_CLOSED") ||
		strings.HasPrefix(message, "net::ERR_CONNECTION_RESET"))
}

func deduplicate(items []model.Item) []model.Item {
	index := make(map[string]int, len(items))
	result := make([]model.Item, 0, len(items))
	for _, item := range items {
		if i, ok := index[item.ID]; ok {
			result[i] = item
		} else {
			index[item.ID] = len(result)
			result = append(result, item)
		}
	}
	return result
}
