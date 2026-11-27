package market

import (
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

type PhoneSearchPage struct {
	PageURL string            `json:"pageUrl"`
	Items   []PhoneSearchItem `json:"items"`
}

type PhoneSearchItem struct {
	Href        string `json:"href"`
	Name        string `json:"name"`
	Image       string `json:"image"`
	Price       string `json:"price"`
	MarketPrice string `json:"marketPrice"`
}

// SurugayaPhoneItems validates results from the first page of the saved search.
func SurugayaPhoneItems(condition model.Condition, page PhoneSearchPage) ([]model.Item, error) {
	if len(page.PageURL) > 4096 || !sameSearch(SearchURL(model.Surugaya, condition), page.PageURL, surugayaRules) {
		return nil, TargetMismatch
	}
	if page.Items == nil || len(page.Items) > 120 {
		return nil, InvalidItems
	}
	items := make([]model.Item, 0, len(page.Items))
	for _, row := range page.Items {
		item, err := surugayaPhoneItem(row)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return deduplicate(items), nil
}

func surugayaPhoneItem(row PhoneSearchItem) (model.Item, error) {
	name := strings.TrimSpace(row.Name)
	price, marketPrice := strings.TrimSpace(row.Price), strings.TrimSpace(row.MarketPrice)
	match := surugayaProduct.FindStringSubmatch(row.Href)
	link := resolveURL(surugayaURL, row.Href)
	target, err := url.Parse(link)
	if len(row.Href) > 255 || match == nil || err != nil || !isSurugayaHTTPS(target) || target.Hostname() != "www.suruga-ya.jp" ||
		strings.TrimSuffix(target.Path, "/") != match[1] ||
		name == "" || utf8.RuneCountInString(name) > 255 || utf8.RuneCountInString(price) > 255 || utf8.RuneCountInString(marketPrice) > 255 {
		return model.Item{}, InvalidItems
	}
	image := ""
	if len(row.Image) <= 2048 {
		resolved := resolveURL(surugayaURL, row.Image)
		if parsed, err := url.Parse(resolved); err == nil && isSurugayaHTTPS(parsed) {
			image = resolved
		}
	}
	// Keep the raw href for existing records and distinguish the detail and shop offer links.
	return model.Item{ID: row.Href, URL: link, Name: name, Image: image, Price: price, MarketPrice: marketPrice}, nil
}

func isSurugayaHTTPS(target *url.URL) bool {
	host := target.Hostname()
	return target.Scheme == "https" && target.User == nil && port(target) == "443" &&
		(host == "suruga-ya.jp" || strings.HasSuffix(host, ".suruga-ya.jp"))
}
