package market

import (
	"fmt"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

var mercariIDPattern = regexp.MustCompile(`/item/(m\d+)`)

func parseHTML(raw string) (*html.Node, error) {
	document, err := html.Parse(strings.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("parse marketplace HTML: %w", err)
	}
	return document, nil
}

func parseMercariItems(raw string) ([]model.Item, error) {
	document, err := parseHTML(raw)
	if err != nil {
		return nil, err
	}
	cells := descendants(document, func(node *html.Node) bool {
		return node.Type == html.ElementNode && attr(node, "data-testid") == "item-cell"
	})
	items := make([]model.Item, 0, len(cells))
	for _, cell := range cells {
		link := firstDescendant(cell, func(node *html.Node) bool {
			return node.Type == html.ElementNode && node.Data == "a" && attr(node, "data-testid") == "thumbnail-link"
		})
		if link == nil {
			continue
		}
		href := attr(link, "href")
		id := ""
		if match := mercariIDPattern.FindStringSubmatch(href); len(match) == 2 {
			id = match[1]
		} else {
			id = path.Base(strings.TrimRight(href, "/"))
		}
		if id == "" || id == "." || id == "/" {
			continue
		}
		image := firstDescendant(cell, element("img"))
		priceNode := firstDescendant(cell, func(node *html.Node) bool {
			return node.Type == html.ElementNode && strings.Contains(attr(node, "class"), "number")
		})
		sold := firstDescendant(cell, func(node *html.Node) bool {
			return attr(node, "role") == "img" && attr(node, "data-testid") == "thumbnail-sticker" && attr(node, "aria-label") == "売り切れ"
		}) != nil
		status := "STATUS_ON_SALE"
		if sold {
			status = "STATUS_SOLD_OUT"
		}
		thumbnail := attr(image, "src")
		item := model.Item{ID: id, Name: attr(image, "alt"), Price: normalizedText(priceNode), Status: status}
		if thumbnail != "" {
			item.Thumbnails = []string{thumbnail}
		}
		items = append(items, item)
	}
	return items, nil
}

func parseYahooItems(raw string) ([]model.Item, error) {
	document, err := parseHTML(raw)
	if err != nil {
		return nil, err
	}
	products := descendants(document, hasClass("Product"))
	items := make([]model.Item, 0, len(products))
	for _, product := range products {
		link := firstDescendant(product, hasClass("Product__titleLink"))
		if link == nil {
			continue
		}
		id := attr(link, "data-auction-id")
		if id == "" {
			continue
		}
		bonus := firstDescendant(product, hasClass("Product__bonus"))
		bid := firstDescendant(product, hasClass("Product__bid"))
		endSeconds := parseInt(attr(bonus, "data-auction-endtime"))
		items = append(items, model.Item{
			ID: id, Name: attr(link, "data-auction-title"), Thumbnail: attr(link, "data-auction-img"),
			CurrentPrice: parseInt(attr(link, "data-auction-price")), BuyNowPrice: parseInt(attr(bonus, "data-auction-buynowprice")),
			CurrentBidCount: parseInt(normalizedText(bid)), EndTime: int64(endSeconds) * 1000,
			FreeShipping: attr(link, "data-auction-isfreeshipping") == "1",
			BrandNew:     firstDescendant(product, hasClass("Product__icon--unused")) != nil,
		})
	}
	return items, nil
}

func parseSurugayaItems(raw string) ([]model.Item, error) {
	document, err := parseHTML(raw)
	if err != nil {
		return nil, err
	}
	nodes := descendants(document, hasClass("item"))
	items := make([]model.Item, 0, len(nodes))
	seen := make(map[string]struct{})
	for _, node := range nodes {
		titleBox := firstDescendant(node, hasClass("title"))
		link := firstDescendant(titleBox, element("a"))
		if link == nil {
			continue
		}
		id := absoluteURL("https://www.suruga-ya.jp", attr(link, "href"))
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		imageBox := firstDescendant(node, hasClass("thum"))
		image := firstDescendant(imageBox, element("img"))
		thumb := attr(image, "src")
		if thumb == "" {
			thumb = attr(image, "data-src")
		}
		nameNode := firstDescendant(node, hasClass("product-name"))
		priceBox := firstDescendant(node, hasClass("price_teika"))
		price := firstDescendant(priceBox, element("strong"))
		marketBox := firstDescendant(node, func(n *html.Node) bool { return hasClass("mgnB5")(n) && hasClass("mgnT5")(n) })
		marketPrice := firstDescendant(marketBox, element("strong"))
		items = append(items, model.Item{
			ID: id, Name: normalizedText(nameNode), Thumbnail: thumb,
			Price: normalizedText(price), MarketplacePrice: normalizedText(marketPrice),
		})
	}
	return items, nil
}

func parseMandarakeItems(raw string) ([]model.Item, error) {
	document, err := parseHTML(raw)
	if err != nil {
		return nil, err
	}
	blocks := descendants(document, hasClass("block"))
	items := make([]model.Item, 0, len(blocks))
	for _, block := range blocks {
		if firstDescendant(block, hasClass("soldout")) != nil {
			continue
		}
		titleBox := firstDescendant(block, hasClass("title"))
		link := firstDescendant(titleBox, element("a"))
		if link == nil {
			continue
		}
		id := attr(block, "data-itemidx")
		if id == "" {
			id = attr(link, "id")
		}
		if id == "" || strings.HasPrefix(id, "#") {
			if parsed, parseErr := url.Parse(attr(link, "href")); parseErr == nil {
				id = parsed.Query().Get("itemCode")
			}
		}
		if id == "" || strings.HasPrefix(id, "#") {
			continue
		}
		thumbBox := firstDescendant(block, hasClass("thum"))
		image := firstDescendant(thumbBox, element("img"))
		thumbnail := attr(image, "data-src")
		if thumbnail == "" {
			thumbnail = attr(image, "src")
		}
		priceBox := firstDescendant(block, hasClass("price"))
		priceNode := firstDescendant(priceBox, element("p"))
		item := model.Item{ID: id, Name: normalizedText(link), Price: normalizedText(priceNode)}
		if thumbnail != "" {
			item.Thumbnails = []string{thumbnail}
		}
		items = append(items, item)
	}
	return items, nil
}

func parseSnapshot(raw string, site model.Site, id string) (model.Snapshot, error) {
	document, err := parseHTML(raw)
	if err != nil {
		return model.Snapshot{}, err
	}
	var price string
	var sold bool
	switch site {
	case model.SiteMercari:
		currency := firstDescendant(document, func(node *html.Node) bool { return attr(node, "data-testid") == "converted-currency-section" })
		paragraphs := descendants(currency, element("p"))
		if len(paragraphs) >= 3 {
			price = normalizedText(paragraphs[2])
		}
		if price == "" {
			price = normalizedText(firstDescendant(document, func(node *html.Node) bool { return attr(node, "data-testid") == "price" }))
		}
		sold = firstDescendant(document, func(node *html.Node) bool {
			return attr(node, "data-testid") == "thumbnail-sticker" && attr(node, "aria-label") == "売り切れ"
		}) != nil
	case model.SiteSurugaya:
		price = normalizedText(firstDescendant(document, func(node *html.Node) bool {
			return hasClass("text-price-detail")(node) && hasClass("price-buy")(node)
		}))
		sold = firstDescendant(document, func(node *html.Node) bool { return attr(node, "value") == "入荷待ちリストへ" }) != nil
	case model.SiteYahoo:
		status := firstDescendant(document, func(node *html.Node) bool { return attr(node, "id") == "itemStatus" })
		price = normalizedText(firstDescendant(status, element("span")))
		if price == "" {
			price = normalizedText(firstDescendant(document, hasClass("Price__value")))
		}
	case model.SiteMandarake:
		priceNode := firstDescendant(document, func(node *html.Node) bool {
			return hasClass("shohin_price")(node) && hasClass("__price")(node)
		})
		if priceNode != nil {
			for sibling := priceNode.NextSibling; sibling != nil; sibling = sibling.NextSibling {
				if sibling.Type == html.ElementNode && sibling.Data == "p" {
					price = normalizedText(sibling)
					break
				}
			}
		}
		sold = firstDescendant(document, hasClass("soldout")) != nil
	default:
		return model.Snapshot{}, fmt.Errorf("unsupported marketplace %q", site)
	}
	titleMeta := firstDescendant(document, func(node *html.Node) bool {
		return node.Type == html.ElementNode && node.Data == "meta" && attr(node, "property") == "og:title"
	})
	imageMeta := firstDescendant(document, func(node *html.Node) bool {
		return node.Type == html.ElementNode && node.Data == "meta" && attr(node, "property") == "og:image"
	})
	title := strings.TrimSpace(attr(titleMeta, "content"))
	image := strings.TrimSpace(attr(imageMeta, "content"))
	status := "on_sale"
	if sold {
		status = "sold_out"
	}
	if title == "" || (price == "" && !sold) {
		status = "invalid"
	}
	result := model.Snapshot{ID: id, Name: title, Price: price, Status: status}
	if image != "" {
		result.Thumbnails = []string{image}
	}
	return result, nil
}

func descendants(root *html.Node, predicate func(*html.Node) bool) []*html.Node {
	if root == nil {
		return nil
	}
	result := make([]*html.Node, 0)
	var visit func(*html.Node)
	visit = func(node *html.Node) {
		if predicate(node) {
			result = append(result, node)
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(root)
	return result
}

func firstDescendant(root *html.Node, predicate func(*html.Node) bool) *html.Node {
	if root == nil {
		return nil
	}
	if predicate(root) {
		return root
	}
	for child := root.FirstChild; child != nil; child = child.NextSibling {
		if match := firstDescendant(child, predicate); match != nil {
			return match
		}
	}
	return nil
}

func element(name string) func(*html.Node) bool {
	return func(node *html.Node) bool { return node != nil && node.Type == html.ElementNode && node.Data == name }
}

func hasClass(name string) func(*html.Node) bool {
	return func(node *html.Node) bool {
		for _, class := range strings.Fields(attr(node, "class")) {
			if class == name {
				return true
			}
		}
		return false
	}
}

func attr(node *html.Node, name string) string {
	if node == nil {
		return ""
	}
	for _, attribute := range node.Attr {
		if strings.EqualFold(attribute.Key, name) {
			return attribute.Val
		}
	}
	return ""
}

func normalizedText(node *html.Node) string {
	if node == nil {
		return ""
	}
	parts := make([]string, 0)
	var visit func(*html.Node)
	visit = func(current *html.Node) {
		if current.Type == html.TextNode {
			parts = append(parts, current.Data)
		}
		for child := current.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(node)
	return strings.Join(strings.Fields(strings.Join(parts, " ")), " ")
}

func parseInt(value string) int {
	cleaned := strings.NewReplacer(",", "", "¥", "", "円", "").Replace(strings.TrimSpace(value))
	parsed, _ := strconv.Atoi(cleaned)
	return parsed
}

func absoluteURL(base, reference string) string {
	if reference == "" {
		return ""
	}
	parsed, err := url.Parse(reference)
	if err != nil {
		return ""
	}
	if parsed.IsAbs() {
		return parsed.String()
	}
	baseURL, _ := url.Parse(base)
	return baseURL.ResolveReference(parsed).String()
}
