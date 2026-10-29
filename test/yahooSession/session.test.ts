import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readYahooCookies, YahooSessionError } from "../../src/api/site/yahoo/session";
import { YahooAuctionApi } from "../../src/api/site/yahoo";
import { YahooHunterService } from "../../src/service/hunterArsenal/yahoo";

const now = Date.now();
const cookie = { name: "test-session", value: "synthetic-secret", domain: ".yahoo.co.jp", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" };
let directory: string, file: string;
const save = (changes = {}) => writeFileSync(file, JSON.stringify({ version: 1, status: "ready", validatedAt: new Date(now).toISOString(), cookies: [cookie], ...changes }));
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "yahoo-session-test-")); file = join(directory, "session.json"); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it("reads rotated credentials on the next scan and preserves scope and security attributes", () => {
  save();
  expect(readYahooCookies({ file }, "", now)).toEqual([cookie]);
  const rotated = { ...cookie, value: "rotated", domain: "auctions.yahoo.co.jp", path: "/my" };
  save({ cookies: [rotated] });
  expect(readYahooCookies({ file }, "", now)).toEqual([rotated]);
});

it.each([
  [{ status: "needs_login" }, "NEEDS_LOGIN"],
  [{ validatedAt: new Date(now - 21601000).toISOString() }, "STATE_STALE"],
  [{ validatedAt: new Date(now + 120000).toISOString() }, "STATE_STALE"],
  [{ cookies: [{ ...cookie, domain: ".yahoo.co.jp.evil.example" }] }, "COOKIE_DOMAIN_INVALID"],
  [{ cookies: [{ ...cookie, expires: now / 1000 - 1 }] }, "COOKIES_EXPIRED"],
  [{ status: "unknown" }, "STATE_INVALID"],
  [{ cookies: [] }, "COOKIES_MISSING"],
])("rejects unsafe snapshot %j without falling back", (state, code) => {
  save(state);
  expect(() => readYahooCookies({ file }, "old=secret", now)).toThrow(code);
});

it("does not fall back for missing, malformed or null managed state", () => {
  expect(() => readYahooCookies({ file }, "old=secret", now)).toThrow("STATE_UNREADABLE");
  writeFileSync(file, "null");
  expect(() => readYahooCookies({ file }, "old=secret", now)).toThrow("STATE_INVALID");
  writeFileSync(file, "{");
  expect(() => readYahooCookies({ file }, "old=secret", now)).toThrow("STATE_UNREADABLE");
});

it("retains last validated credentials during a transient failure, bounded by max age", () => {
  save({ status: "error", lastError: "UPSTREAM_ERROR" });
  expect(readYahooCookies({ file }, "", now)).toEqual([cookie]);
  expect(() => readYahooCookies({ file }, "", now + 21601000)).toThrow("STATE_STALE");
});

it("filters expired cookies and reloads legacy files dynamically", () => {
  save({ cookies: [cookie, { ...cookie, name: "expired", expires: 1 }] });
  expect(readYahooCookies({ file }, "", now)).toEqual([cookie]);
  writeFileSync(file, "legacy=one");
  expect(readYahooCookies({ legacyFile: file })[0].value).toBe("one");
  writeFileSync(file, "legacy=two==\n");
  expect(readYahooCookies({ legacyFile: file })[0].value).toBe("two==");
});

function apiWithResponse(response: any) {
  const api = new YahooAuctionApi();
  api.sessionConfig = { file, authenticatedSelector: "[data-authenticated]" };
  api.logger = { info: jest.fn() } as any;
  api.alicloudApi = { fetchHtmlViaServerless: jest.fn().mockResolvedValue(response) } as any;
  save();
  return api;
}

it("rejects a login redirect even when the body resembles an empty result", async () => {
  const api = apiWithResponse({ success: true, url: "https://login.yahoo.co.jp/config/login", content: "<p>条件に一致する商品は見つかりませんでした</p>" });
  await expect(api.fetchGoodsList({ keyword: "test" })).rejects.toThrow("FC_NEEDS_LOGIN");
});

it("requires both the account URL and positive markup for the FC check", async () => {
  const api = apiWithResponse({ success: true, url: "https://auctions.yahoo.co.jp/my", content: "<div data-authenticated>Account</div>" });
  expect(await api.checkCookieHeartBeat()).toEqual({ result: true });
  (api.alicloudApi.fetchHtmlViaServerless as jest.Mock).mockResolvedValue({ success: true, url: "https://auctions.yahoo.co.jp/my", content: "<body>Loading</body>" });
  expect(await api.checkCookieHeartBeat()).toEqual({ result: false, reason: "FC_AUTH_UNVERIFIED" });
  (api.alicloudApi.fetchHtmlViaServerless as jest.Mock).mockRejectedValue(new Error("synthetic-secret"));
  expect(await api.checkCookieHeartBeat()).toEqual({ result: false, reason: "FC_CHECK_FAILED" });
});

it.each(["/my/bidding", "https://auctions.yahoo.co.jp/my/bidding"])("recognizes current Yahoo personal-page navigation: %s", async href => {
  const response = { success: true, url: "https://auctions.yahoo.co.jp/my", content: `<a href="${href}">入札中</a>` };
  const api = apiWithResponse(response);
  api.sessionConfig.authenticatedSelector = undefined;
  expect(await api.checkCookieHeartBeat()).toEqual({ result: true });
  (api.alicloudApi.fetchHtmlViaServerless as jest.Mock).mockResolvedValue({ ...response, url: "https://login.yahoo.co.jp/config/login" });
  expect(await api.checkCookieHeartBeat()).toEqual({ result: false, reason: "FC_NEEDS_LOGIN" });
});

it("stops a hunt before changing seen records when the managed session is unavailable", async () => {
  const service = new YahooHunterService();
  service.hunterModel = { findOne: jest.fn().mockResolvedValue({ searchConditionSchema: '{"keyword":"test"}', user: {} }) } as any;
  service.yahooApi = { fetchGoodsList: jest.fn().mockRejectedValue(new YahooSessionError("NEEDS_LOGIN")) } as any;
  service.yahooAuctionRecordModel = { find: jest.fn() } as any;
  service.logger = { error: jest.fn() } as any;
  await service.goHunt("test-job");
  expect(service.yahooAuctionRecordModel.find).not.toHaveBeenCalled();
});

it("throttles sanitized alerts and resets the throttle after recovery", async () => {
  const service = new YahooHunterService();
  service.yahooApi = { checkCookieHeartBeat: jest.fn().mockResolvedValue({ result: false, reason: "NEEDS_LOGIN" }) } as any;
  service.emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) } as any;
  service.mailInfo = { contactSystemOwner: "test@example.invalid" } as any;
  service.logger = { info: jest.fn() } as any;
  await service["cookieHeartBeatCheck"]();
  await service["cookieHeartBeatCheck"]();
  expect(service.emailService.sendEmail).toHaveBeenCalledTimes(1);
  expect((service.emailService.sendEmail as jest.Mock).mock.calls[0][0].text).toContain("NEEDS_LOGIN");
  (service.yahooApi.checkCookieHeartBeat as jest.Mock).mockResolvedValueOnce({ result: true });
  await service["cookieHeartBeatCheck"]();
  await service["cookieHeartBeatCheck"]();
  expect(service.emailService.sendEmail).toHaveBeenCalledTimes(2);
});
