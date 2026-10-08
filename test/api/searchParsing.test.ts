import { readFileSync } from "fs";
import { join } from "path";
import { YahooAuctionApi } from "../../src/api/site/yahoo";
import { MercariApi } from "../../src/api/site/mercari";
import { render } from "ejs";

const fixture = (name: string) => readFileSync(join(__dirname, "../fixtures/search", name + ".html"), "utf8");
function apiWithHtml<T>(api: T, content: string, success = true): T {
  return Object.assign(api, {
    logger: { info: jest.fn(), error: jest.fn() },
    alicloudApi: { fetchHtmlViaServerless: jest.fn().mockResolvedValue({ success, content }) },
  });
}
const mercariOptions = { keyword: "本間芽衣子", status: [], pageSize: 120 };

describe("search page compatibility", () => {
  it("parses Mercari cards without item-grid, including prices and sold status", async () => {
    const api = apiWithHtml(new MercariApi(), fixture("mercari-new"));
    const { items } = await api.fetchGoodsList(mercariOptions);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "m37885764030", price: "16250", status: "STATUS_ON_SALE" });
    expect(items[0].name).not.toContain("サムネイル");
    expect(items[1]).toMatchObject({ id: "m47098121356", price: "75000", status: "STATUS_SOLD_OUT" });
  });

  it("ignores lazy placeholders and deduplicates Mercari cards", async () => {
    const html = fixture("mercari-new");
    const api = apiWithHtml(new MercariApi(), html + html + '<li data-testid="item-cell"></li>');
    expect((await api.fetchGoodsList(mercariOptions)).items).toHaveLength(2);
  });

  it("still reads the older Mercari markup", async () => {
    const api = apiWithHtml(new MercariApi(), '<div id="item-grid"><li data-testid="item-cell"><a data-testid="thumbnail-link" href="/item/m123"><img src="https://example.com/a.jpg" alt="旧商品"></a><span class="number">1,200</span><div role="img" data-testid="thumbnail-sticker" aria-label="売り切れ"></div></li></div>');
    expect((await api.fetchGoodsList(mercariOptions)).items[0]).toMatchObject({ id: "m123", name: "旧商品", price: "1200", status: "STATUS_SOLD_OUT" });
  });

  it("handles Mercari auction prices and preserves Shops product links", async () => {
    const api = apiWithHtml(new MercariApi(), '<ul><li data-testid="item-cell"><a data-testid="thumbnail-link" href="/item/m87846990896"><p data-testid="thumbnail-item-name">Auction</p><span data-testid="item-tile-price">現在 ¥2,100</span></a></li><li data-testid="item-cell"><a data-testid="thumbnail-link" href="/shops/product/2JWSxYDo9jEuC5oQR5Lf7i"><p data-testid="thumbnail-item-name">Shop</p><span data-testid="item-tile-price">¥935</span></a></li></ul>');
    const { items } = await api.fetchGoodsList(mercariOptions);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "m87846990896", price: "2100" });
    expect(items[1]).toMatchObject({ id: "2JWSxYDo9jEuC5oQR5Lf7i", price: "935", url: "https://jp.mercari.com/shops/product/2JWSxYDo9jEuC5oQR5Lf7i" });
    const template = readFileSync(join(__dirname, "../../view/mercari/goodsList.ejs"), "utf8");
    const email = render(template, { data: items, serverHost: "localhost" });
    expect(email).toContain('href="https://jp.mercari.com/shops/product/2JWSxYDo9jEuC5oQR5Lf7i"');
    expect(email).not.toContain('href="https://jp.mercari.com/item/2JWSxYDo9jEuC5oQR5Lf7i"');
  });

  it("parses Yahoo opensearch, including tax-inclusive price, bid count and end time", async () => {
    const api = apiWithHtml(new YahooAuctionApi(), fixture("yahoo-new"));
    const items = await api.fetchGoodsList({ keyword: "本間芽衣子" });
    expect(items).toHaveLength(4); // Yahoo Flea Market is not an auction URL.
    expect(items[0]).toMatchObject({ id: "x1247466554", currentPrice: 500, currentBidCount: 0, endTime: 1791634426000, isBrandNew: true });
    expect(items[1]).toMatchObject({ id: "f1247450018", currentPrice: 1001 }); // tracking says 910 before tax
    expect(items[2]).toMatchObject({ id: "h1246255540", currentPrice: 1500, buyNowPrice: 1800 });
    expect(items[3]).toMatchObject({ id: "g1247032993", currentBidCount: 6, isFreeShipping: true });
    expect(items.every(item => !!item.name && !!item.thumbImgUrl)).toBe(true);
  });

  it("preserves legacy Yahoo parsing", async () => {
    const api = apiWithHtml(new YahooAuctionApi(), fixture("yahoo-old"));
    const items = await api.fetchGoodsList({ keyword: "本間芽衣子" });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "x1247466554", currentPrice: 500, endTime: 1791634426000 });
  });

  it("uses the site's 50-item page offsets and deduplicates overlapping pages", async () => {
    const api = apiWithHtml(new YahooAuctionApi(), fixture("yahoo-new"));
    const items = await api.fetchGoodsList({ keyword: "本間芽衣子", epoch: 2, category: "26084" });
    expect(items).toHaveLength(4);
    const calls = (api.alicloudApi.fetchHtmlViaServerless as jest.Mock).mock.calls;
    expect(calls.map(c => new URL(c[0]).searchParams.get("b"))).toEqual(["1", "51"]);
    expect(calls.every(c => new URL(c[0]).searchParams.get("auccat") === "26084")).toBe(true);
  });

  it.each(["mercari", "yahoo"])("rejects unrecognized or unfinished %s pages instead of returning empty", async site => {
    const api = site === "mercari" ? new MercariApi() : new YahooAuctionApi();
    apiWithHtml(api, '<html><body>Loading...</body></html>');
    await expect(api.fetchGoodsList(mercariOptions)).rejects.toThrow(/page|markup/i);
  });

  it.each(["mercari", "yahoo"])("rejects failed FC responses for %s", async site => {
    const api = site === "mercari" ? new MercariApi() : new YahooAuctionApi();
    apiWithHtml(api, fixture(site === "mercari" ? "mercari-new" : "yahoo-new"), false);
    await expect(api.fetchGoodsList(mercariOptions)).rejects.toThrow();
  });

  it("recognizes Yahoo's explicit no-results message", async () => {
    const api = apiWithHtml(new YahooAuctionApi(), '<p>条件に一致する商品は<br>見つかりませんでした</p>');
    expect(await api.fetchGoodsList({ keyword: "no-match" })).toEqual([]);
  });
});
