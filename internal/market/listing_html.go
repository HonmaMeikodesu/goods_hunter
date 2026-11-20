package market

import (
	"cmp"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/PuerkitoBio/goquery"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

const mercariLink = `li[data-testid="item-cell"] a[data-testid="thumbnail-link"]`
const yahooLegacyCard = ".Result__body .Products__items .Product"

var mercariRules = pageRules{
	QueryKeys: []string{"keyword", "sort", "order"},
	ItemSelector: "#item-grid " + mercariLink + `, [data-testid="search-item-grid"] ` + mercariLink +
		", " + mercariLink + `[data-location^="search_result:"][data-location*=":item_list:"]`,
	EmptySelector: `main p, main h2, main h3, [data-testid="search-no-results"], #item-grid p`,
	EmptyTexts:    []string{"該当する商品が見つかりませんでした", "該当する商品がありません", "該当する商品はありません"},
}

var yahooRules = pageRules{
	QueryKeys:     []string{"p", "auccat", "b", "n", "s1", "o1"},
	QueryDefaults: map[string]string{"b": "1", "n": "50"},
	ItemSelector:  `a[href*="/auction/"][data-cl-params*="_cl_vmodule:aal"] [data-grid-item-title], ` + yahooLegacyCard,
	EmptySelector: ".Result__body .Products .Notice, .Result__body p, main p, main h2, [role=main] p",
	EmptyTexts:    []string{"条件に一致する商品は見つかりませんでした", "一致する商品はありません。キーワードの一部を利用した結果を表示しています"},
}

var surugayaRules = pageRules{
	QueryKeys:     []string{"search_word", "category", "page", "adult_s", "is_marketplace", "rankBy"},
	QueryDefaults: map[string]string{"page": "1", "adult_s": "2"},
	ItemSelector:  "#search_result .item_box .item",
	EmptySelector: "#search_header .hit, #search_result > p, #search_result > h2, #search_result > .notice",
	EmptyTexts:    []string{"該当件数:0件", "該当件数:0件中", "該当する商品がありません", "該当する商品はありません", "該当する商品が見つかりませんでした"},
}

var mandarakeRules = pageRules{
	QueryKeys:     []string{"keyword", "page"},
	QueryDefaults: map[string]string{"page": "1"},
	ItemSelector:  ".entry .thumlarge .block",
	EmptySelector: ".list_nav__count, .entry p, .entry h2, .entry .notice",
	EmptyTexts:    []string{"検索結果0", "検索結果0件", "該当する商品がありません", "該当する商品はありません", "該当する商品が見つかりませんでした"},
}

var (
	mercariID       = regexp.MustCompile(`^/(?:item|shops/product)/([a-zA-Z0-9]+)(?:[?#]|$)`)
	yenPrice        = regexp.MustCompile(`^(?:現在\s*)?[¥￥]?\s*(\d+(?:,\d{3})*)$`)
	currencyPrice   = regexp.MustCompile(`\p{Sc}|円|^[A-Z]{3}\s*[\d,.]+$|^[\d,.]+\s*[A-Z]{3}$`)
	digit           = regexp.MustCompile(`\d`)
	yahooID         = regexp.MustCompile(`^(?:/jp)?/auction/([a-zA-Z0-9]+)$`)
	plainID         = regexp.MustCompile(`^[a-zA-Z0-9]+$`)
	labeledYen      = regexp.MustCompile(`^\s*([\d,]+)\s*円`)
	leadingInteger  = regexp.MustCompile(`^[+-]?[0-9]+`)
	surugayaProduct = regexp.MustCompile(`^(?:https://www\.suruga-ya\.jp)?/product/detail/([a-zA-Z0-9]+)(?:[/?#]|$)`)
	mandarakeCode   = regexp.MustCompile(`itemCode=(\d+)`)
)

func parseMercari(links *goquery.Selection) ([]model.Item, error) {
	items := make([]model.Item, 0, links.Length())
	positions := make(map[string]int)
	for _, link := range links.EachIter() {
		href := link.AttrOr("href", "")
		match := mercariID.FindStringSubmatch(href)
		if match == nil {
			continue
		}
		cell := link.Closest(`li[data-testid="item-cell"]`)
		image := cell.Find("img").First()
		name := strings.TrimSpace(cell.Find(`[data-testid="thumbnail-item-name"]`).First().Text())
		if name == "" {
			name = strings.TrimSpace(image.AttrOr("alt", ""))
		}
		if name == "" {
			continue
		}
		sold := cell.Find(`div[role="img"][data-testid="thumbnail-sticker"][aria-label="売り切れ"]`).Length() > 0 ||
			strings.TrimSpace(cell.Find(`[data-testid="item-tile-sticker"]`).First().Text()) == "SOLD"
		status := "STATUS_ON_SALE"
		if sold {
			status = "STATUS_SOLD_OUT"
		}
		item := model.Item{ID: match[1], Name: name, URL: mercariURL + href, Status: status,
			Price: mercariPrice(cell), Image: resolveURL(mercariURL, image.AttrOr("src", ""))}
		if index, exists := positions[item.ID]; exists {
			if items[index].Price == "" && item.Price != "" {
				items[index] = item
			}
			continue
		}
		positions[item.ID] = len(items)
		items = append(items, item)
	}
	if len(items) == 0 {
		return nil, InvalidItems
	}
	return items, nil
}

func mercariPrice(cell *goquery.Selection) string {
	for _, selector := range []string{`[data-testid="item-tile-price"]`, ".merPrice", `.number, [class^="number__"], [class*=" number__"]`} {
		node := cell.Find(selector).First()
		if node.Length() == 0 {
			continue
		}
		display := strings.Join(strings.Fields(node.Text()), " ")
		if match := yenPrice.FindStringSubmatch(display); match != nil {
			return strings.ReplaceAll(match[1], ",", "")
		}
		if len([]rune(display)) <= 120 && digit.MatchString(display) && currencyPrice.MatchString(display) {
			return display
		}
		return ""
	}
	return ""
}

func parseYahoo(cards *goquery.Selection) ([]model.Item, error) {
	var items []model.Item
	for _, title := range cards.Filter("[data-grid-item-title]").EachIter() {
		link := title.Closest("a")
		card := title.Closest("li")
		metadata := make(map[string]string)
		for _, entry := range strings.Split(link.AttrOr("data-cl-params", ""), ";") {
			key, value, ok := strings.Cut(entry, ":")
			if ok && key != "" {
				metadata[key] = value
			}
		}
		if metadata["_cl_vmodule"] != "aal" {
			continue
		}
		location, err := url.Parse(resolveURL(yahooURL, link.AttrOr("href", "")))
		if err != nil || (location.Hostname() != "auctions.yahoo.co.jp" && location.Hostname() != "page.auctions.yahoo.co.jp") {
			return nil, InvalidItems
		}
		id := yahooID.FindStringSubmatch(location.Path)
		if id == nil || card.Length() == 0 {
			return nil, InvalidItems
		}
		buy := auctionPrice(link, "即決")
		price := auctionPrice(link, "現在")
		if price == nil {
			price = buy
		}
		bidText := strings.TrimSpace(card.Find(`[aria-label="入札件数"]`).First().Closest("p").Text())
		if bidText == "" {
			bidText = "0"
		}
		bids := integer(strings.ReplaceAll(bidText, ",", ""))
		end := integer(metadata["end"])
		name := strings.TrimSpace(title.Text())
		image := card.Find("a[href] img").First().AttrOr("src", "")
		if end == nil || *end <= 0 || bids == nil || name == "" || image == "" || price == nil {
			return nil, InvalidItems
		}
		items = append(items, model.Item{ID: id[1], Name: name, Amount: *price, BuyNow: buy, BidCount: bids,
			URL: "https://page.auctions.yahoo.co.jp/jp/auction/" + id[1], Image: resolveURL(yahooURL, image)})
	}
	if len(items) > 0 {
		return items, nil
	}
	for _, card := range cards.Filter(yahooLegacyCard).EachIter() {
		detail := card.Find(".Product__detail .Product__bonus").First()
		title := card.Find(".Product__detail .Product__titleLink").First()
		id := title.AttrOr("data-auction-id", "")
		name := title.AttrOr("data-auction-title", "")
		price := legacyInteger(title.AttrOr("data-auction-price", ""))
		end := legacyInteger(detail.AttrOr("data-auction-endtime", ""))
		bids := legacyInteger(card.Find(".Product__bidWrap .Product__bid").First().Text())
		if !plainID.MatchString(id) || strings.TrimSpace(name) == "" || price == nil || end == nil || *end <= 0 || bids == nil {
			return nil, InvalidItems
		}
		items = append(items, model.Item{ID: id, Name: name, Amount: *price, BidCount: bids,
			BuyNow: legacyInteger(detail.AttrOr("data-auction-buynowprice", "")),
			URL:    "https://page.auctions.yahoo.co.jp/jp/auction/" + id, Image: resolveURL(yahooURL, title.AttrOr("data-auction-img", ""))})
	}
	if len(items) == 0 {
		return nil, InvalidItems
	}
	return items, nil
}

func auctionPrice(link *goquery.Selection, label string) *int64 {
	for _, row := range link.Find("p").EachIter() {
		if strings.TrimSpace(row.Children().First().Text()) != label {
			continue
		}
		amount := labeledYen.FindStringSubmatch(strings.TrimPrefix(strings.TrimSpace(row.Text()), label))
		if amount != nil {
			return integer(strings.ReplaceAll(amount[1], ",", ""))
		}
		return nil
	}
	return nil
}

func legacyInteger(value string) *int64 {
	return integer(leadingInteger.FindString(strings.TrimSpace(value)))
}

func integer(value string) *int64 {
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return nil
	}
	return &parsed
}

func parseSurugaya(cards *goquery.Selection) ([]model.Item, error) {
	items := make([]model.Item, 0, cards.Length())
	for _, card := range cards.EachIter() {
		link := card.Find(".item_detail .title > a").First().AttrOr("href", "")
		name := card.Find(".item_detail .product-name").First().Text()
		if !surugayaProduct.MatchString(link) || strings.TrimSpace(name) == "" {
			return nil, InvalidItems
		}
		items = append(items, model.Item{ID: link, Name: name, URL: resolveURL(surugayaURL, link),
			Image:       resolveURL(surugayaURL, card.Find(".thum img").First().AttrOr("src", "")),
			Price:       strings.TrimSpace(card.Find(".item_price .price_teika strong").First().Text()),
			MarketPrice: strings.TrimSpace(card.Find(".item_price .mgnB5.mgnT5 strong").First().Text())})
	}
	return items, nil
}

func parseMandarake(cards *goquery.Selection) ([]model.Item, error) {
	items := make([]model.Item, 0, cards.Length())
	for _, block := range cards.EachIter() {
		title := block.Find(".title a").First()
		name := strings.TrimSpace(title.Text())
		id := block.AttrOr("data-itemidx", "")
		if id == "" {
			id = title.AttrOr("id", "")
		}
		if id == "" || id == "#adult_confirm" {
			if matched := mandarakeCode.FindStringSubmatch(title.AttrOr("href", "")); matched != nil {
				id = matched[1]
			}
		}
		if id == "" || strings.HasPrefix(id, "#") || name == "" {
			return nil, InvalidItems
		}
		if block.Find(".soldout").Length() > 0 {
			continue
		}
		thumbnail := block.Find(".thum img").First()
		image := thumbnail.AttrOr("data-src", "")
		if image == "" {
			image = thumbnail.AttrOr("src", "")
		}
		price, _, _ := strings.Cut(strings.TrimSpace(block.Find(".price p").First().Text()), "\n")
		items = append(items, model.Item{ID: id, Name: name,
			URL:   mandarakeURL + "/order/detailPage/item?itemCode=" + url.QueryEscape(id) + "&deviceId=1",
			Image: resolveURL(mandarakeURL, image), Price: cmp.Or(strings.TrimSpace(price), "0")})
	}
	return items, nil
}

func resolveURL(base, value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	origin, err := url.Parse(base)
	if err != nil {
		return ""
	}
	target, err := origin.Parse(value)
	if err != nil || target.Hostname() == "" || target.User != nil || (target.Scheme != "https" && target.Scheme != "http") {
		return ""
	}
	return target.String()
}
