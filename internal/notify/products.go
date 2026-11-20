package notify

import (
	"bytes"
	"cmp"
	_ "embed"
	"fmt"
	"html/template"
	"net/url"
	"path"
	"strconv"
	"strings"

	"github.com/HonmaMeikodesu/goods_hunter/internal/market"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

//go:embed products.html
var productsHTML string

var productsTemplate = template.Must(template.New("products").Parse(productsHTML))

type card struct {
	Name     string
	URL      string
	Image    string
	Price    string
	Sold     bool
	WatchURL string
	StopURL  string
	OldPrice string
	TwoLines bool
}

func SearchMessage(w model.Watcher, condition model.Condition, items []model.Item, publicURL string) (Message, error) {
	cards := make([]card, 0, len(items))
	subject := searchSubject(w.Site, condition.Keyword)
	for _, item := range items {
		product := card{Name: item.Name, URL: item.URL, Image: item.Image, Price: item.Price}
		site, id := strings.ToLower(string(w.Site)), item.ID
		switch w.Site {
		case model.Mercari:
			product.Price = cmp.Or(item.Price, "价格暂缺")
			product.Sold = item.Status != "STATUS_ON_SALE"
		case model.Surugaya:
			product.Price = cmp.Or(item.Price, item.MarketPrice)
			if u, err := url.Parse(item.URL); err == nil {
				id = path.Base(strings.TrimRight(u.Path, "/"))
			}
		case model.Yahoo:
			product.Price = strconv.FormatInt(item.Amount, 10)
		case model.YahooFleamarket:
			product.Price = fmt.Sprintf("¥%d", item.Amount)
		case model.Xianyu:
			product.Price = fmt.Sprintf("人民币 ¥%d.%02d", item.Amount/100, item.Amount%100)
			product.TwoLines = true
		}
		if !w.Site.UsesBaseline() {
			query := url.Values{"type": {site}, "goodId": {id}}
			product.WatchURL = publicURL + "/goods/registerSurveillanceWatcher?" + query.Encode()
		}
		cards = append(cards, product)
	}
	return renderProducts(w.Owner, subject, cards)
}

func searchSubject(site model.Site, keyword string) string {
	switch site {
	case model.Xianyu:
		return "闲鱼 新发现商品：" + keyword
	case model.YahooFleamarket:
		return "Yahoo!フリマ 新发现商品：" + keyword
	case model.Yahoo:
		return "New update on yahoo auctions of your interest, keyword:" + keyword
	case model.Surugaya:
		return "New update on surugaya auctions of your interest, keyword:" + keyword
	case model.Mandarake:
		return "New update on Mandarake goods of your interest, keyword:" + keyword
	default:
		return "New update on mercari goods of your interest, keyword:" + keyword
	}
}

func SnapshotMessage(w model.Watcher, detailSite string, current, next model.Snapshot, publicURL string) (Message, error) {
	query := url.Values{"type": {string(model.Surveillance)}, "id": {w.ID}}
	product := card{Name: next.Name, URL: market.DetailURL(detailSite, next.ID),
		Sold: next.Status == "sold_out", Price: next.Price, OldPrice: current.Price,
		StopURL: publicURL + "/goods/unregisterGoodsWatcher?" + query.Encode()}
	if len(next.Thumbnails) > 0 {
		product.Image = next.Thumbnails[0]
	}
	return renderProducts(w.Owner, detailSite+" item: "+next.Name, []card{product})
}

func renderProducts(recipient, subject string, cards []card) (Message, error) {
	var html bytes.Buffer
	if err := productsTemplate.Execute(&html, cards); err != nil {
		return Message{}, err
	}
	return Message{To: recipient, Subject: subject, HTML: html.String()}, nil
}
