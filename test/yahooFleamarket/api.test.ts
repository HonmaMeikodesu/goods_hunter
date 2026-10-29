import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { AliCloudApi } from "../../src/api/alicloud";
import { YahooFleamarketApi } from "../../src/api/site/yahooFleamarket";
import { normalizeYahooFleamarketCondition } from "../../src/api/site/yahooFleamarket/conditions";
import { YahooFleamarketPageResponse } from "../../src/api/site/yahooFleamarket/types";

const good = (id: string, overrides = {}) => ({
  id, name: `缶バッジ ${id}`, price: 1200, status: "OPEN", thumbnailImageUrl: "https://example.com/image.jpg",
  itemUrl: `https://paypayfleamarket.yahoo.co.jp/item/${id}`, ...overrides,
});
const page = (number: number, items: any[]): YahooFleamarketPageResponse => ({
  success: true, source: "yahooFleamarket", keyword: "缶バッジ", page: number,
  offset: (number - 1) * 100, totalResultsAvailable: 200, items, fetchedAt: new Date().toISOString(),
});

describe("Yahoo!フリマ conditions and FC adapter", () => {
  it("normalizes equivalent conditions and rejects invalid inputs", () => {
    expect(normalizeYahooFleamarketCondition({ keyword: " 缶バッジ ", excludeKeywords: ["B", " a ", "b"] }))
      .toEqual({ keyword: "缶バッジ", epoch: 1, excludeKeywords: ["a", "b"], notifyExisting: false });
    for (const condition of [{ keyword: " " }, { keyword: "x", epoch: 4 }, { keyword: "x", minPrice: -1 },
      { keyword: "x", minPrice: 2, maxPrice: 1 }, { keyword: "x", excludeKeywords: "x" }, { keyword: "x", notifyExisting: "true" }]) {
      expect(() => normalizeYahooFleamarketCondition(condition as any)).toThrow();
    }
  });

  it("scans all configured pages, deduplicates opaque IDs, and filters prices and statuses", async () => {
    const api = new YahooFleamarketApi();
    const fetch = jest.fn()
      .mockResolvedValueOnce(page(1, [good("h123"), good("old", { openTime: "2000-01-01" }), good("sold", { status: "SOLD" })]))
      .mockResolvedValueOnce(page(2, [good("h123"), good("o123"), good("cheap", { price: 1 }), good("exclude", { name: "缶バッジ セット" })]));
    api.alicloudApi = { fetchYahooFleamarketPage: fetch } as any;
    const result = await api.fetchGoodsList({ keyword: "缶バッジ", epoch: 2, minPrice: 100, maxPrice: 2000, excludeKeywords: ["セット"] });
    expect(result.map(item => item.id)).toEqual(["h123", "old", "o123"]);
    expect(fetch).toHaveBeenNthCalledWith(2, { keyword: "缶バッジ", page: 2, onSaleOnly: true });
  });

  it("rejects partial failed scans and stale pages instead of treating them as empty", async () => {
    const api = new YahooFleamarketApi();
    api.alicloudApi = { fetchYahooFleamarketPage: jest.fn().mockResolvedValueOnce(page(1, [good("1")])).mockRejectedValueOnce(new Error("FC unavailable")) } as any;
    await expect(api.fetchGoodsList({ keyword: "缶バッジ", epoch: 2 })).rejects.toThrow("FC unavailable");
    api.alicloudApi = { fetchYahooFleamarketPage: jest.fn().mockResolvedValue(page(1, [])) } as any;
    await expect(api.fetchGoodsList({ keyword: "缶バッジ", epoch: 2 })).rejects.toThrow("invalid search response");
  });

  it("sanitizes notification URLs and rejects corrupt merchandise", async () => {
    const api = new YahooFleamarketApi();
    api.alicloudApi = { fetchYahooFleamarketPage: jest.fn().mockResolvedValue(page(1, [good("h/?", { itemUrl: "javascript:alert(1)", thumbnailImageUrl: "javascript:alert(1)" })])) } as any;
    const [item] = await api.fetchGoodsList({ keyword: "缶バッジ" });
    expect(item.itemUrl).toBe("https://paypayfleamarket.yahoo.co.jp/item/h%2F%3F");
    expect(item.thumbnailImageUrl).toBe("");
    api.alicloudApi = { fetchYahooFleamarketPage: jest.fn().mockResolvedValue(page(1, [good("x", { price: "1200" })])) } as any;
    await expect(api.fetchGoodsList({ keyword: "缶バッジ" })).rejects.toThrow("invalid merchandise");
  });
});

describe("signed FC HTTP transport", () => {
  let server: Server;
  let url: string;
  const received: any[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        res.setHeader("Connection", "close");
        received.push({ path: req.url, authorization: req.headers.authorization, body: JSON.parse(body) });
        if (req.url === "/denied") { res.writeHead(429); res.end("rate limited"); return; }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(req.url === "/legacy" ? { success: true, content: "<html>legacy</html>" } : page(1, [good("h123")])));
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

  function client() {
    const fc = new AliCloudApi();
    fc.alicloudConfig = { accessKeyId: "test-id", accessKeySecret: "test-secret", url: `${url}/legacy`, yahooFleamarketUrl: `${url}/search` };
    fc.logger = { info: jest.fn(), error: jest.fn() } as any;
    return fc;
  }

  it("sends structured search requests to the new signed function", async () => {
    const result = await client().fetchYahooFleamarketPage({ keyword: "缶バッジ", page: 1, onSaleOnly: true });
    expect(result.items[0].id).toBe("h123");
    expect(received[received.length - 1]).toMatchObject({ path: "/search", body: { keyword: "缶バッジ", page: 1, onSaleOnly: true } });
    expect(received[received.length - 1].authorization).toMatch(/^ACS3-HMAC-SHA256 Credential=test-id,/);
  });

  it("preserves the generic FC payload for existing platforms", async () => {
    expect((await client().fetchHtmlViaServerless("https://example.com", "Result", [], 10, 2, "1+1")).content).toBe("<html>legacy</html>");
    expect(received[received.length - 1]).toMatchObject({ path: "/legacy", body: {
      target_url: "https://example.com", page_loaded_assertion: "Result", cookies: [], max_assertion_wait_seconds: 10, max_retries: 2, evaluate_script: "1+1",
    } });
  });

  it("calls FC directly even when a process-wide proxy is configured", async () => {
    const keys = ["HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"];
    const previous: Record<string, string | undefined> = {};
    for (const key of keys) previous[key] = process.env[key];
    try {
      process.env.HTTP_PROXY = process.env.http_proxy = "http://127.0.0.1:1";
      process.env.NO_PROXY = process.env.no_proxy = "";
      const result = await client().fetchYahooFleamarketPage({ keyword: "缶バッジ", page: 1, onSaleOnly: true });
      expect(result.success).toBe(true);
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });

  it("fails clearly when the new endpoint is missing or rate limited", async () => {
    const fc = client();
    fc.alicloudConfig.yahooFleamarketUrl = "";
    await expect(fc.fetchYahooFleamarketPage({ keyword: "x", page: 1, onSaleOnly: true })).rejects.toThrow("YAHOO_FLEAMARKET_FC_URL");
    fc.alicloudConfig.yahooFleamarketUrl = `${url}/denied`;
    await expect(fc.fetchYahooFleamarketPage({ keyword: "x", page: 1, onSaleOnly: true })).rejects.toThrow("429");
  });
});
