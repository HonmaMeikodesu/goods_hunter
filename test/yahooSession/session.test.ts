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

function alertStore() {
  let expiresAt = 0;
  return { set: jest.fn(async () => {
    if (expiresAt > Date.now()) return null;
    expiresAt = Date.now() + 86400000;
    return "OK";
  }) };
}

function alertService(store = alertStore(), reason = "NEEDS_LOGIN") {
  const service = new YahooHunterService();
  service.yahooApi = { checkCookieHeartBeat: jest.fn().mockResolvedValue({ result: false, reason }) } as any;
  service.emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) } as any;
  service.redisClient = store as any;
  service.mailInfo = { contactSystemOwner: "test@example.invalid" } as any;
  service.logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
  return service;
}

it("keeps the alert cooldown when the FC check briefly recovers", async () => {
  const service = alertService();
  await service["cookieHeartBeatCheck"]();
  (service.yahooApi.checkCookieHeartBeat as jest.Mock).mockResolvedValueOnce({ result: true });
  await service["cookieHeartBeatCheck"]();
  await service["cookieHeartBeatCheck"]();
  expect(service.emailService.sendEmail).toHaveBeenCalledTimes(1);
});

it("shares an atomic daily cooldown across concurrent workers and restarts", async () => {
  const store = alertStore();
  const first = alertService(store), second = alertService(store);
  await Promise.all([first["cookieHeartBeatCheck"](), second["cookieHeartBeatCheck"]()]);
  const restarted = alertService(store);
  await restarted["cookieHeartBeatCheck"]();
  expect(first.emailService.sendEmail).toHaveBeenCalledTimes(1);
  expect(second.emailService.sendEmail).not.toHaveBeenCalled();
  expect(restarted.emailService.sendEmail).not.toHaveBeenCalled();
  expect(store.set).toHaveBeenCalledWith("goods-hunter:yahoo:login-alert:v1", "1", "EX", 86400, "NX");
});

it("allows a reminder after 24 hours without requiring an intervening recovery", async () => {
  const clock = jest.spyOn(Date, "now").mockReturnValue(now);
  try {
    const service = alertService();
    await service["cookieHeartBeatCheck"]();
    clock.mockReturnValue(now + 86399999);
    await service["cookieHeartBeatCheck"]();
    expect(service.emailService.sendEmail).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + 86400000);
    await service["cookieHeartBeatCheck"]();
    expect(service.emailService.sendEmail).toHaveBeenCalledTimes(2);
  } finally { clock.mockRestore(); }
});

it.each(["NEEDS_LOGIN", "FC_NEEDS_LOGIN", "COOKIES_EXPIRED"])("sends login reminders for %s", async reason => {
  const service = alertService(undefined, reason);
  await service["cookieHeartBeatCheck"]();
  const mail = (service.emailService.sendEmail as jest.Mock).mock.calls[0][0];
  expect(mail.subject).toBe("Yahoo session needs login");
  expect(mail.text).toContain(reason);
});

it.each(["FC_CHECK_FAILED", "FC_AUTH_UNVERIFIED", "STATE_UNREADABLE", "STATE_INVALID",
  "STATE_STALE", "COOKIES_MISSING", "COOKIE_INVALID", "COOKIE_DOMAIN_INVALID",
  "LEGACY_UNREADABLE", "synthetic-secret"])("only logs %s without sending or consuming the login cooldown", async reason => {
  const service = alertService(undefined, reason);
  await service["cookieHeartBeatCheck"]();
  expect(service.emailService.sendEmail).not.toHaveBeenCalled();
  expect(service.redisClient.set).not.toHaveBeenCalled();
  expect(JSON.stringify((service.logger.info as jest.Mock).mock.calls)).not.toContain("synthetic-secret");
  (service.yahooApi.checkCookieHeartBeat as jest.Mock).mockResolvedValueOnce({ result: false, reason: "NEEDS_LOGIN" });
  await service["cookieHeartBeatCheck"]();
  expect(service.emailService.sendEmail).toHaveBeenCalledTimes(1);
});

it("does not send unthrottled mail when Redis is unavailable", async () => {
  const service = alertService();
  (service.redisClient.set as jest.Mock).mockRejectedValue(new Error("synthetic-secret"));
  await service["cookieHeartBeatCheck"]();
  expect(service.emailService.sendEmail).not.toHaveBeenCalled();
  expect(JSON.stringify((service.logger.error as jest.Mock).mock.calls)).not.toContain("synthetic-secret");
});

it("retains the cooldown after an ambiguous SMTP failure", async () => {
  const service = alertService();
  (service.emailService.sendEmail as jest.Mock).mockRejectedValue(new Error("synthetic-secret"));
  await service["cookieHeartBeatCheck"]();
  await service["cookieHeartBeatCheck"]();
  expect(service.emailService.sendEmail).toHaveBeenCalledTimes(1);
});
