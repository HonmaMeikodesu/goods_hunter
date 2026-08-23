package hunter

import (
	"bytes"
	"fmt"
	"html/template"
	"net/url"
	"path"
	"strings"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

var itemListTemplate = template.Must(template.New("items").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GoodsHunter</title><style>
body{font-family:system-ui,sans-serif;margin:16px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.item{border:1px solid #ddd;border-radius:8px;padding:8px}.item img{display:block;width:100%;height:220px;object-fit:contain}
.name{margin:8px 0;line-height:1.4}.price{font-size:1.2rem;font-weight:700}.sold{color:#b00020;font-weight:700}
</style></head><body><div class="grid">{{range .Items}}<article class="item">
<a href="{{.ItemURL}}">{{if .Image}}<img src="{{.Image}}" alt="">{{end}}</a>
<div class="price">{{.Price}}</div>{{if .Sold}}<div class="sold">SOLD</div>{{end}}<div class="name">{{.Name}}</div>
<a href="{{.SubscribeURL}}">Subscribe to this item</a></article>{{end}}</div></body></html>`))

var snapshotTemplate = template.Must(template.New("snapshot").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GoodsHunter</title><style>body{font-family:system-ui,sans-serif;margin:24px}.card{max-width:480px;margin:auto}.card img{width:100%;max-height:420px;object-fit:contain}.price{font-size:2rem;font-weight:700;text-align:center}.sold{color:#b00020;font-weight:700}</style>
</head><body><article class="card"><a href="{{.ItemURL}}">{{if .Image}}<img src="{{.Image}}" alt="">{{end}}</a>
{{if .Sold}}<p class="sold">SOLD</p>{{end}}<h2>{{.Name}}</h2><p class="price">{{.OldPrice}} → {{.NewPrice}}</p>
<p><a href="{{.CancelURL}}">Cancel this subscription</a></p></article></body></html>`))

type itemView struct {
	Name         string
	Price        string
	Image        string
	ItemURL      string
	SubscribeURL string
	Sold         bool
}

func renderItemList(hunterType model.HunterType, items []model.Item, baseURL string) (string, string, error) {
	site := model.SiteForHunter(hunterType)
	views := make([]itemView, 0, len(items))
	var text strings.Builder
	for _, item := range items {
		image := item.Thumbnail
		if image == "" && len(item.Thumbnails) > 0 {
			image = item.Thumbnails[0]
		}
		id := surveillanceID(site, item.ID)
		view := itemView{
			Name: item.Name, Price: item.DisplayPrice(), Image: image,
			ItemURL:      itemURL(site, item.ID),
			SubscribeURL: baseURL + "/goods/registerSurveillanceWatcher?type=" + url.QueryEscape(string(site)) + "&goodId=" + url.QueryEscape(id),
			Sold:         strings.Contains(strings.ToLower(item.Status), "sold"),
		}
		views = append(views, view)
		_, _ = fmt.Fprintf(&text, "%s | %s | %s\n", view.Name, view.Price, view.ItemURL)
	}
	var htmlBody bytes.Buffer
	if err := itemListTemplate.Execute(&htmlBody, map[string]any{"Items": views}); err != nil {
		return "", "", fmt.Errorf("render item list: %w", err)
	}
	return htmlBody.String(), text.String(), nil
}

func renderSnapshot(site model.Site, latest, previous model.Snapshot, watcherID, baseURL string) (string, string, error) {
	image := ""
	if len(latest.Thumbnails) > 0 {
		image = latest.Thumbnails[0]
	}
	data := struct {
		Name, OldPrice, NewPrice, Image, ItemURL, CancelURL string
		Sold                                                bool
	}{
		Name: latest.Name, OldPrice: previous.Price, NewPrice: latest.Price, Image: image,
		ItemURL:   itemURL(site, latest.ID),
		CancelURL: baseURL + "/goods/unregisterGoodsWatcher?id=" + url.QueryEscape(watcherID) + "&type=Surveillance",
		Sold:      latest.Status == "sold_out",
	}
	var htmlBody bytes.Buffer
	if err := snapshotTemplate.Execute(&htmlBody, data); err != nil {
		return "", "", fmt.Errorf("render item snapshot: %w", err)
	}
	textBody := fmt.Sprintf("%s\n%s -> %s\n%s\nCancel: %s", latest.Name, previous.Price, latest.Price, data.ItemURL, data.CancelURL)
	return htmlBody.String(), textBody, nil
}

func itemURL(site model.Site, id string) string {
	switch site {
	case model.SiteMercari:
		return "https://jp.mercari.com/item/" + url.PathEscape(id)
	case model.SiteYahoo:
		return "https://page.auctions.yahoo.co.jp/jp/auction/" + url.PathEscape(id)
	case model.SiteSurugaya:
		if parsed, err := url.Parse(id); err == nil && parsed.IsAbs() {
			return parsed.String()
		}
		return "https://www.suruga-ya.jp/product/detail/" + url.PathEscape(id)
	case model.SiteMandarake:
		return "https://order.mandarake.co.jp/order/detailPage/item?itemCode=" + url.QueryEscape(id) + "&deviceId=1"
	default:
		return ""
	}
}

func surveillanceID(site model.Site, id string) string {
	if site != model.SiteSurugaya {
		return id
	}
	if parsed, err := url.Parse(id); err == nil {
		return path.Base(strings.TrimRight(parsed.Path, "/"))
	}
	return path.Base(strings.TrimRight(id, "/"))
}
