package market

import (
	"context"
	"net/url"
	"strings"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

func DetailURL(site, id string) string {
	switch site {
	case "mercari":
		return mercariURL + "/item/" + url.PathEscape(id)
	case "yahoo":
		return yahooURL + "/jp/auction/" + url.PathEscape(id)
	case "surugaya":
		return surugayaURL + "/product/detail/" + url.PathEscape(id)
	case "mandarake":
		return mandarakeURL + "/order/detailPage/item?itemCode=" + url.QueryEscape(id)
	default:
		return ""
	}
}

func (c *Client) Snapshot(ctx context.Context, condition model.Condition) (model.Snapshot, error) {
	site, id := condition.DetailSite, condition.GoodID
	request := htmlRequest{TargetURL: DetailURL(site, id), Retries: 3}
	var priceSelector, soldSelector string
	switch site {
	case "mercari":
		request.Evaluate, request.Assertion = mercariJPY, `data-testid="price"`
		priceSelector = `[data-testid="converted-currency-section"] > p:nth-child(3)`
		soldSelector = `div[role="img"][data-testid="thumbnail-sticker"][aria-label="売り切れ"]`
	case "surugaya":
		request.Cookies, request.Assertion = &surugayaCookies, "price_group"
		priceSelector, soldSelector = ".text-price-detail.price-buy", `[value="入荷待ちリストへ"]`
	case "yahoo":
		cookies, err := c.yahooCookies(time.Now())
		if err != nil {
			return model.Snapshot{}, err
		}
		if len(cookies) > 0 {
			request.Cookies = &cookies
		}
		request.Assertion = "itemStatus"
		priceSelector = "div > div > div > dl > dd > span"
	case "mandarake":
		request.Cookies, request.Assertion = &mandarakeCookies, "在庫"
		priceSelector, soldSelector = ".shohin_price.__price+p", ".operate .soldout"
	default:
		return model.Snapshot{}, InvalidRequest
	}
	response, err := c.render(ctx, request)
	if err != nil {
		return model.Snapshot{}, err
	}
	if site == "yahoo" && yahooLoginRedirect(response.URL) {
		return model.Snapshot{}, LoginRequired
	}
	doc, err := readHTML(response)
	if err != nil {
		return model.Snapshot{}, err
	}
	price := doc.Find(priceSelector).First().Text()
	title := doc.Find(`meta[property="og:title"]`).First().AttrOr("content", "")
	sold := soldSelector != "" && doc.Find(soldSelector).Length() > 0
	if strings.TrimSpace(title) == "" || (strings.TrimSpace(price) == "" && !sold) {
		return model.Snapshot{}, InvalidItems
	}
	status := "on_sale"
	if sold {
		status = "sold_out"
	}
	image := doc.Find(`meta[property="og:image"]`).First().AttrOr("content", "")
	return model.Snapshot{ID: id, Name: title, Price: price, Status: status,
		Thumbnails: []string{resolveURL(request.TargetURL, image)}}, nil
}
