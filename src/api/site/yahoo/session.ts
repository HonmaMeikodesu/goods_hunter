import { readFileSync } from "fs";

export interface YahooCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  partitionKey?: string;
}

export interface YahooSessionConfig {
  file?: string;
  legacyFile?: string;
  maxAgeSeconds?: number;
  authenticatedSelector?: string;
}

export class YahooSessionError extends Error {
  constructor(public readonly code: string) {
    super(`Yahoo session unavailable: ${code}`);
    this.name = "YahooSessionError";
  }
}

export const DEFAULT_YAHOO_AUTH_SELECTOR = 'a[href*="login.yahoo.co.jp"][href*="logout"], a[href="/my/bidding"], a[href="https://auctions.yahoo.co.jp/my/bidding"]';

function parseFile(file: string): any {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new YahooSessionError("STATE_UNREADABLE"); }
}

// Read once per scan; never cache credentials in application configuration.
// An explicitly configured managed session must never fall back to old cookies.
export function readYahooCookies(config: YahooSessionConfig = {}, fallback = "", now = Date.now()): YahooCookie[] | undefined {
  if (!config.file) {
    let raw = fallback;
    if (config.legacyFile) {
      try { raw = readFileSync(config.legacyFile, "utf8").replace(/[\r\n]/g, ""); }
      catch (error) {
        if (error.code !== "ENOENT") throw new YahooSessionError("LEGACY_UNREADABLE");
        raw = "";
      }
    }
    return raw ? raw.split(";").map(part => {
      const [name, ...value] = part.trim().split("=");
      return { name, value: value.join("="), domain: "auctions.yahoo.co.jp", path: "/" };
    }).filter(cookie => cookie.name && cookie.value) : undefined;
  }

  const state = parseFile(config.file);
  const maxAge = config.maxAgeSeconds ?? 21600;
  if (!state || state.version !== 1 || !["ready", "error", "needs_login"].includes(state.status)) throw new YahooSessionError("STATE_INVALID");
  if (state.status === "needs_login") throw new YahooSessionError("NEEDS_LOGIN");
  const validatedAt = Date.parse(state.validatedAt);
  if (!Number.isFinite(maxAge) || maxAge <= 0 || !Number.isFinite(validatedAt) || validatedAt > now + 60000 || now - validatedAt > maxAge * 1000) {
    throw new YahooSessionError("STATE_STALE");
  }
  if (!Array.isArray(state.cookies) || !state.cookies.length) throw new YahooSessionError("COOKIES_MISSING");
  const cookies: YahooCookie[] = [];
  for (const cookie of state.cookies) {
    if (!cookie || typeof cookie.name !== "string" || !cookie.name || typeof cookie.value !== "string" ||
        typeof cookie.domain !== "string" || typeof cookie.path !== "string" || !cookie.path.startsWith("/")) {
      throw new YahooSessionError("COOKIE_INVALID");
    }
    // Preserve scope; never widen a host-only cookie to a parent domain.
    const domain = cookie.domain.replace(/^\./, "");
    if (!(domain === "yahoo.co.jp" || domain.endsWith(".yahoo.co.jp"))) throw new YahooSessionError("COOKIE_DOMAIN_INVALID");
    if (cookie.expires !== undefined && (typeof cookie.expires !== "number" || !Number.isFinite(cookie.expires))) throw new YahooSessionError("COOKIE_INVALID");
    if (cookie.expires !== undefined && cookie.expires !== -1 && cookie.expires <= now / 1000) continue;
    for (const key of ["httpOnly", "secure"]) {
      if (cookie[key] !== undefined && typeof cookie[key] !== "boolean") throw new YahooSessionError("COOKIE_INVALID");
    }
    if (cookie.sameSite !== undefined && !["Strict", "Lax", "None"].includes(cookie.sameSite)) throw new YahooSessionError("COOKIE_INVALID");
    if (cookie.partitionKey !== undefined && typeof cookie.partitionKey !== "string") throw new YahooSessionError("COOKIE_INVALID");
    const accepted: YahooCookie = { name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path };
    for (const key of ["expires", "httpOnly", "secure", "sameSite", "partitionKey"]) {
      if (cookie[key] !== undefined) accepted[key] = cookie[key];
    }
    cookies.push(accepted);
  }
  if (!cookies.length) throw new YahooSessionError("COOKIES_EXPIRED");
  return cookies;
}

export function yahooPageNeedsLogin(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "login.yahoo.co.jp" || parsed.hostname.endsWith(".login.yahoo.co.jp");
  } catch { return true; }
}

export function isYahooMyPage(url?: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "auctions.yahoo.co.jp" &&
      ["/my", "/my/", "/user/jp/show/mystatus"].includes(parsed.pathname);
  } catch { return false; }
}
