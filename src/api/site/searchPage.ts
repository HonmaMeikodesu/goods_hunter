import { JSDOM } from "jsdom";
import type { FetchHtmlViaServerlessResponse } from "../alicloud";
import { knownScanFailure, ScanFailure, SearchScanError } from "./searchScan";

export type SearchResultState = "items" | "empty";

export interface SearchPageRules {
  queryKeys: readonly string[];
  queryDefaults?: Readonly<Record<string, string>>;
  itemSelector: string;
  emptySelector: string;
  emptyTexts: readonly string[];
}

function sameSearch(target: string, final: string, rules: SearchPageRules): boolean {
  try {
    const expected = new URL(target);
    const actual = new URL(final);
    if (actual.origin !== expected.origin || actual.pathname.replace(/\/+$/, "") !== expected.pathname.replace(/\/+$/, "")) {
      return false;
    }
    return rules.queryKeys.every(key => {
      const defaultValue = rules.queryDefaults?.[key] ?? "";
      const actualValues = actual.searchParams.getAll(key);
      return actualValues.length <= 1 &&
        (actualValues[0] ?? defaultValue) === (expected.searchParams.get(key) ?? defaultValue);
    });
  } catch {
    return false;
  }
}

function fetchFailure(response: FetchHtmlViaServerlessResponse): ScanFailure {
  const code = knownScanFailure(response?.code);
  if (code) return code;
  const error = typeof response.error === "string" ? response.error : "";
  if (/\bnet::ERR_CONNECTION_CLOSED\b/.test(error)) return "CONNECTION_CLOSED";
  if (/\bnet::ERR_CONNECTION_RESET\b/.test(error)) return "CONNECTION_RESET";
  if (response.cloudflare_detected === true || /cloudflare/i.test(error)) return "CLOUDFLARE_CHALLENGE";
  return /timeout|net::ERR_TIMED_OUT/i.test(error) ? "FETCH_TIMEOUT" : "FETCH_FAILED";
}

function normalizeNotice(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, "").replace(/[。.]+$/u, "");
}

function isShown(element: Element): boolean {
  return !element.closest('script, style, template, noscript, [hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"]');
}

// The HTML checks also cover the deployed collector during a rolling upgrade,
// when the collector can still omit resultState.
export function parseSearchPage<T>(
  response: FetchHtmlViaServerlessResponse,
  targetUrl: string,
  rules: SearchPageRules,
  parse: (document: Document, state: SearchResultState, cards: Element[]) => T,
): T {
  if (typeof response?.success !== "boolean") {
    throw new SearchScanError("INVALID_RESPONSE", "FC returned an invalid search response");
  }
  if (!response.success) {
    const connectionError = typeof response.error === "string"
      ? response.error.match(/\bnet::ERR_[A-Z0-9_]+\b/)?.[0] : undefined;
    throw new SearchScanError(fetchFailure(response), connectionError
      ? `Page fetch failed (${connectionError})` : "Search page fetch failed");
  }
  if (typeof response.content !== "string" || !response.content.trim()) {
    throw new SearchScanError("EMPTY_CONTENT");
  }
  const dom = new JSDOM(response.content);
  try {
    const document = dom.window.document;
    if (/^(?:just a moment|attention required)\b.*$/i.test(document.title.trim()) ||
        document.querySelector("#challenge-form, #cf-challenge-running, #cf-please-wait")) {
      throw new SearchScanError("CLOUDFLARE_CHALLENGE");
    }
    if (!sameSearch(targetUrl, response.url, rules)) throw new SearchScanError("TARGET_MISMATCH");

    const notices = rules.emptyTexts.map(normalizeNotice);
    const empty = [...document.querySelectorAll(rules.emptySelector)]
      .some(element => isShown(element) && !element.closest(rules.itemSelector) &&
        notices.includes(normalizeNotice(element.textContent || "")));
    const cards = empty ? [] : [...document.querySelectorAll(rules.itemSelector)].filter(isShown);
    if (!empty && !cards.length) {
      throw new SearchScanError("UNVERIFIED_RESULTS", "Search page has no recognizable items or confirmed empty result");
    }
    const state = empty ? "empty" : "items";
    if (response.resultState !== undefined && response.resultState !== state) {
      throw new SearchScanError("INVALID_RESPONSE", "FC search state does not match the returned HTML");
    }
    return parse(document, state, cards);
  } finally {
    dom.window.close();
  }
}
