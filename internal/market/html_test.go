package market

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

func TestTrackedMarketplaceFixtures(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		path   string
		parser func(string) ([]model.Item, error)
	}{
		{"mercari", "src/api/site/mercari/mock/goodsList.html", parseMercariItems},
		{"yahoo", "src/api/site/yahoo/mock/goodsList.html", parseYahooItems},
		{"surugaya", "src/api/site/surugaya/mock/goodsList.html", parseSurugayaItems},
		{"mandarake", "src/api/site/mandarake/mock/goodsList.html", parseMandarakeItems},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join("..", "..", test.path))
			if err != nil {
				t.Fatal(err)
			}
			items, err := test.parser(string(raw))
			if err != nil {
				t.Fatal(err)
			}
			if len(items) == 0 {
				t.Fatal("fixture produced no items")
			}
			if items[0].ID == "" || items[0].Name == "" {
				t.Fatalf("first parsed item is incomplete: %#v", items[0])
			}
		})
	}
}

func TestParseSnapshotByMarketplace(t *testing.T) {
	t.Parallel()
	tests := []struct {
		site model.Site
		html string
	}{
		{model.SiteMercari, `<meta property="og:title" content="Mercari item"><meta property="og:image" content="https://img/m.jpg"><div data-testid="price">¥1,000</div>`},
		{model.SiteYahoo, `<meta property="og:title" content="Yahoo item"><meta property="og:image" content="https://img/y.jpg"><div id="itemStatus"><span>2000円</span></div>`},
		{model.SiteSurugaya, `<meta property="og:title" content="Surugaya item"><meta property="og:image" content="https://img/s.jpg"><span class="text-price-detail price-buy">3,000円</span>`},
		{model.SiteMandarake, `<meta property="og:title" content="Mandarake item"><meta property="og:image" content="https://img/d.jpg"><div class="shohin_price __price"></div><p>4,000円</p>`},
	}
	for _, test := range tests {
		test := test
		t.Run(string(test.site), func(t *testing.T) {
			snapshot, err := parseSnapshot(test.html, test.site, "id-1")
			if err != nil {
				t.Fatal(err)
			}
			if snapshot.Status != "on_sale" || snapshot.Name == "" || snapshot.Price == "" {
				t.Fatalf("unexpected snapshot: %#v", snapshot)
			}
		})
	}
}
