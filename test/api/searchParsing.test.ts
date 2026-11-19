import { readFileSync } from "fs";
import { join } from "path";
import { YahooAuctionApi } from "../../src/api/site/yahoo";
import { MercariApi } from "../../src/api/site/mercari";
import { SurugayaApi } from "../../src/api/site/surugaya";
import { MandarakeApi } from "../../src/api/site/mandarake";
import { render } from "ejs";

const fixture = (name: string) => readFileSync(join(__dirname, "../fixtures/search", name + ".html"), "utf8");
function apiWithHtml<T>(api: T, content: string, success = true): T {
  return Object.assign(api, {
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    alicloudApi: { fetchHtmlViaServerless: jest.fn(async (url: string) => ({ success, content, url })) },
  });
}
const mercariOptions = { keyword: "本間芽衣子", status: [], pageSize: 120 };
const mercariGrid = (html: string) => '<ul id="item-grid">' + html + '</ul>';

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

  it("keeps complete Mercari cards when a linked card is incomplete, including a later copy of the same item", async () => {
    const incomplete = '<li data-testid="item-cell"><a data-testid="thumbnail-link" href="/item/m37885764030"></a></li>';
    const api = apiWithHtml(new MercariApi(), mercariGrid(incomplete) + fixture("mercari-new"));
    const { items } = await api.fetchGoodsList(mercariOptions);
    expect(items.map(item => item.id)).toEqual(["m37885764030", "m47098121356"]);
    expect(api.logger.warn).toHaveBeenCalledTimes(1);
  });

  it("keeps named listings when all prices are missing or localized, and renders the displayed currency", async () => {
    const html = '<li data-testid="item-cell"><a data-testid="thumbnail-link" href="/item/m111"><img alt="限定キーホルダー"></a></li>' +
      '<li data-testid="item-cell"><a data-testid="thumbnail-link" href="/item/m222"><img alt="フィギュア"><span class="number-of-images">3</span><span data-testid="item-tile-price">HK$ 120.50</span></a></li>';
    const { items } = await apiWithHtml(new MercariApi(), mercariGrid(html)).fetchGoodsList(mercariOptions);
    expect(items.map(item => [item.id, item.price])).toEqual([["m111", null], ["m222", "HK$ 120.50"]]);
    const template = readFileSync(join(__dirname, "../../view/mercari/goodsList.ejs"), "utf8");
    const email = render(template, { data: items, serverHost: "localhost" });
    expect(email).toContain("价格暂缺");
    expect(email).toContain("HK$ 120.50");
  });

  it("uses the priced copy when the same Mercari listing appears twice", async () => {
    const unpriced = '<li data-testid="item-cell"><a data-testid="thumbnail-link" href="/item/m37885764030"><img alt="商品"></a></li>';
    const { items } = await apiWithHtml(new MercariApi(), mercariGrid(unpriced) + fixture("mercari-new") + mercariGrid(unpriced)).fetchGoodsList(mercariOptions);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({id: "m37885764030", price: "16250"});
  });

  it("fails the scan when every linked Mercari card is incomplete", async () => {
    const api = apiWithHtml(new MercariApi(), mercariGrid('<li data-testid="item-cell"><a data-testid="thumbnail-link" href="/item/m1"><img alt="  "><span data-testid="item-tile-price">¥100</span></a></li>'));
    await expect(api.fetchGoodsList(mercariOptions)).rejects.toThrow(/incomplete/i);
  });

  it("reports the upstream Mercari connection error without logging the request URL", async () => {
    const api = apiWithHtml(new MercariApi(), "");
    (api.alicloudApi.fetchHtmlViaServerless as jest.Mock).mockResolvedValue({
      success: false, content: "", error: "Page.goto: net::ERR_CONNECTION_CLOSED at https://example.test/private",
    });
    await expect(api.fetchGoodsList(mercariOptions)).rejects.toMatchObject({
      code: "CONNECTION_CLOSED", message: "Page fetch failed (net::ERR_CONNECTION_CLOSED)",
    });
  });

  it("delays the last Mercari attempt after a transient navigation disconnect", async () => {
    jest.useFakeTimers();
    try {
      const api = apiWithHtml(new MercariApi(), fixture("mercari-new"));
      const fetch = api.alicloudApi.fetchHtmlViaServerless as jest.Mock;
      fetch.mockResolvedValueOnce({ success: false, content: "", cloudflare_detected: false, error: "Page.goto: net::ERR_CONNECTION_CLOSED at https://jp.mercari.com/search" });
      const result = api.fetchGoodsList(mercariOptions).catch(error => error);
      await jest.advanceTimersByTimeAsync(29_999);
      expect(fetch.mock.calls.map(call => call[4])).toEqual([2]);
      await jest.advanceTimersByTimeAsync(1);
      expect(await result).toHaveProperty("items.length", 2);
      expect(fetch.mock.calls.map(call => call[4])).toEqual([2, 1]);
      expect(fetch.mock.calls[0][0]).toBe(fetch.mock.calls[1][0]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops when the upstream reports a challenge even on a disconnected navigation", async () => {
    const api = apiWithHtml(new MercariApi(), "");
    const fetch = api.alicloudApi.fetchHtmlViaServerless as jest.Mock;
    fetch.mockResolvedValue({ success: false, content: "", cloudflare_detected: true, error: "Page.goto: net::ERR_CONNECTION_CLOSED" });
    await expect(api.fetchGoodsList(mercariOptions)).rejects.toThrow(/ERR_CONNECTION_CLOSED/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("still reads the older Mercari markup", async () => {
    const api = apiWithHtml(new MercariApi(), '<div id="item-grid"><li data-testid="item-cell"><a data-testid="thumbnail-link" href="/item/m123"><img src="https://example.com/a.jpg" alt="旧商品"></a><span class="number">1,200</span><div role="img" data-testid="thumbnail-sticker" aria-label="売り切れ"></div></li></div>');
    expect((await api.fetchGoodsList(mercariOptions)).items[0]).toMatchObject({ id: "m123", name: "旧商品", price: "1200", status: "STATUS_SOLD_OUT" });
  });

  it("handles Mercari auction prices and preserves Shops product links", async () => {
    const api = apiWithHtml(new MercariApi(), mercariGrid('<li data-testid="item-cell"><a data-testid="thumbnail-link" href="/item/m87846990896"><p data-testid="thumbnail-item-name">Auction</p><span data-testid="item-tile-price">現在 ¥2,100</span></a></li><li data-testid="item-cell"><a data-testid="thumbnail-link" href="/shops/product/2JWSxYDo9jEuC5oQR5Lf7i"><p data-testid="thumbnail-item-name">Shop</p><span data-testid="item-tile-price">¥935</span></a></li>'));
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
    const api = apiWithHtml(new YahooAuctionApi(), '<main><p>条件に一致する商品は<br>見つかりませんでした</p></main>');
    expect(await api.fetchGoodsList({ keyword: "no-match" })).toEqual([]);
  });

  it("separates a Mercari search notice from a copy in a script, hidden markup, or another search", async () => {
    const notice = "<main><p>該当する商品が見つかりませんでした。</p></main>";
    const api = apiWithHtml(new MercariApi(), notice);
    await expect(api.fetchGoodsList(mercariOptions)).resolves.toEqual({ items: [] });
    const fetch = api.alicloudApi.fetchHtmlViaServerless as jest.Mock;
    for (const content of ["<script>" + notice + "</script>", "<div hidden>" + notice + "</div>"]) {
      fetch.mockImplementationOnce(async url => ({ success: true, url, content }));
      await expect(api.fetchGoodsList(mercariOptions)).rejects.toMatchObject({ code: "UNVERIFIED_RESULTS" });
    }
    fetch.mockResolvedValueOnce({ success: true, url: "https://jp.mercari.com/search?keyword=other", content: notice });
    await expect(api.fetchGoodsList(mercariOptions)).rejects.toMatchObject({ code: "TARGET_MISMATCH" });
    fetch.mockImplementationOnce(async url => ({ success: true, url, content: notice, resultState: "items" }));
    await expect(api.fetchGoodsList(mercariOptions)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("requires every Surugaya page to return products or a confirmed empty result", async () => {
    const html = readFileSync(join(__dirname, "../../src/api/site/surugaya/mock/goodsList.html"), "utf8");
    const api = apiWithHtml(new SurugayaApi(), html);
    const fetch = api.alicloudApi.fetchHtmlViaServerless as jest.Mock;
    const options = { keyword: "本間芽衣子" };
    await expect(api.fetchGoodsList(options)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "https://www.suruga-ya.jp/product/detail/878540321" }),
    ]));
    fetch.mockImplementationOnce(async url => ({ success: true, url, content: '<div id="search_header"><div class="hit">該当件数：０件</div></div>' }));
    await expect(api.fetchGoodsList(options)).resolves.toEqual([]);
    fetch.mockImplementationOnce(async url => ({ success: true, url, content: html }));
    fetch.mockResolvedValueOnce({ success: false, code: "CLOUDFLARE_CHALLENGE", content: "<title>Just a moment...</title>" });
    await expect(api.fetchGoodsList({ ...options, epoch: 2 })).rejects.toMatchObject({ code: "CLOUDFLARE_CHALLENGE" });
    fetch.mockImplementationOnce(async url => ({ success: true, url, content: '<title>駿河屋</title><div id="search_result"></div>' }));
    await expect(api.fetchGoodsList(options)).rejects.toMatchObject({ code: "UNVERIFIED_RESULTS" });
  });

  it("accepts a readable Mandarake list with all items sold and rejects an empty shell", async () => {
    const api = apiWithHtml(new MandarakeApi(), '<div class="entry"><div class="thumlarge"><div class="block" data-itemidx="123"><div class="title"><a>商品</a></div><span class="soldout">Sold</span></div></div></div>');
    const options = { keyword: "商品" };
    const fetch = api.alicloudApi.fetchHtmlViaServerless as jest.Mock;
    await expect(api.fetchGoodsList(options)).resolves.toEqual({ items: [] });
    fetch.mockImplementationOnce(async url => ({ success: true, url, resultState: "empty", content: '<div class="list_nav__count">検索結果 0</div>' }));
    await expect(api.fetchGoodsList(options)).resolves.toEqual({ items: [] });
    fetch.mockImplementationOnce(async url => ({ success: true, url, content: '<div class="entry"></div>' }));
    await expect(api.fetchGoodsList(options)).rejects.toMatchObject({ code: "UNVERIFIED_RESULTS" });
  });
});
