import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { AliCloudApi } from "../../src/api/alicloud";
import { XianyuApi } from "../../src/api/site/xianyu";
import { normalizeXianyuCondition, yuanToFen } from "../../src/api/site/xianyu/conditions";

const good = (id: string, overrides = {}) => ({
  id, name: `本间芽衣子 手办 ${id}`, priceFen: 1234, publishedAt: "2026-10-31T14:34:02+00:00",
  thumbnailImageUrl: "https://img.alicdn.com/example.jpg", itemUrl: `https://www.goofish.com/item?id=${id}`, ...overrides,
});
const response = (items: any[] = [good("123")], overrides = {}) => ({
  success: true, source: "xianyu", keyword: "本间芽衣子", page: 1, pageSize: 30, sort: "newest", currency: "CNY",
  resultState: items.length ? "items" : "empty", hasMore: true, items, fetchedAt: new Date().toISOString(), ...overrides,
});
function apiWith(data: any) {
  const api = new XianyuApi();
  api.alicloudApi = { fetchXianyuSearch: jest.fn().mockResolvedValue(data) } as any;
  return api;
}

describe("Xianyu conditions and FC results", () => {
  it("normalizes title filters and CNY decimals without silently accepting unimplemented options", () => {
    expect(normalizeXianyuCondition({ keyword: " 本间芽衣子 ", includeKeywords: ["B", " b ", "A"] }))
      .toEqual({ keyword: "本间芽衣子", includeKeywords: ["a", "b"], excludeKeywords: [], notifyExisting: false });
    expect(yuanToFen(0.29)).toBe(29);
    for (const value of [{ keyword: " " }, { keyword: "x", epoch: 2 }, { keyword: "x", minPrice: 1.001 },
      { keyword: "x", minPrice: "1" }, { keyword: "x", minPrice: -1 }, { keyword: "x", minPrice: 3, maxPrice: 2 },
      { keyword: "x", includeKeywords: "x" }, { keyword: "x", notifyExisting: "true" }]) {
      expect(() => normalizeXianyuCondition(value as any)).toThrow();
    }
  });

  it("filters titles/prices and deduplicates item IDs while preserving cents", async () => {
    const api = apiWith(response([good("123"), good("123"), good("456", { priceFen: 1235 }), good("789", { name: "面膜" }), good("999", { name: "本间芽衣子 手办 求购" })]));
    const items = await api.fetchGoodsList({ keyword: "本间芽衣子", minPrice: 12.34, maxPrice: 12.34, includeKeywords: ["手办"], excludeKeywords: ["求购"] });
    expect(items.map(i => i.id)).toEqual(["123"]);
    expect(items[0].priceFen).toBe(1234);
    expect(api.alicloudApi.fetchXianyuSearch).toHaveBeenCalledWith({ keyword: "本间芽衣子" });
  });

  it("accepts explicit valid empty snapshots but rejects business failures, stale/default results and bad currency", async () => {
    await expect(apiWith(response([])).fetchGoodsList({ keyword: "本间芽衣子" })).resolves.toEqual([]);
    for (const patch of [{ success: false, code: "CHALLENGE_REQUIRED" }, { keyword: "手机" }, { page: 2 }, { sort: "default" }, { currency: "JPY" }, { resultState: "empty" }]) {
      await expect(apiWith(response(undefined, patch)).fetchGoodsList({ keyword: "本间芽衣子" })).rejects.toThrow("invalid search response");
    }
  });

  it("fails the entire snapshot on corrupt items and derives notification links locally", async () => {
    const items = await apiWith(response([good("123", { itemUrl: "javascript:alert(1)", thumbnailImageUrl: "javascript:alert(1)" })])).fetchGoodsList({ keyword: "本间芽衣子" });
    expect(items[0].itemUrl).toBe("https://www.goofish.com/item?id=123");
    expect(items[0].thumbnailImageUrl).toBe("");
    for (const bad of [{ priceFen: "1234" }, { priceFen: 1.1 }, { id: "1<script>" }, { publishedAt: "invalid" }]) {
      await expect(apiWith(response([good("123"), good("456", bad)])).fetchGoodsList({ keyword: "本间芽衣子" })).rejects.toThrow("invalid merchandise");
    }
  });
});

describe("Xianyu signed FC transport", () => {
  let server: Server;
  let url: string;
  const received: any[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        received.push({ body: JSON.parse(body), authorization: req.headers.authorization });
        res.setHeader("Connection", "close");
        res.setHeader("Content-Type", "application/json");
        res.statusCode = req.url === "/blocked" ? 403 : 200;
        res.end(JSON.stringify(req.url === "/blocked" ? { success: false, code: "CHALLENGE_REQUIRED" } : response()));
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

  it("uses the dedicated endpoint, signed request, and non-success HTTP status", async () => {
    const fc = new AliCloudApi();
    fc.logger = { info: jest.fn(), error: jest.fn() } as any;
    fc.alicloudConfig = { url: "https://unused.invalid", accessKeyId: "test-id", accessKeySecret: "test-secret", xianyuUrl: url };
    const result = await fc.fetchXianyuSearch({ keyword: "本间芽衣子" });
    expect(result.items[0].priceFen).toBe(1234);
    expect(received[0].body).toEqual({ keyword: "本间芽衣子" });
    expect(received[0].authorization).toMatch(/^ACS3-HMAC-SHA256 Credential=test-id,/);
    fc.alicloudConfig.xianyuUrl = url + "/blocked";
    await expect(fc.fetchXianyuSearch({ keyword: "x" })).rejects.toThrow("403");
    fc.alicloudConfig.xianyuUrl = "";
    await expect(fc.fetchXianyuSearch({ keyword: "x" })).rejects.toThrow("XIANYU_FC_URL");
  });
});
