import { Provide, Inject, Logger, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { GoodsListResponse, MercariGoodsSearchCondition } from "./types";
import { ApiBase } from "../base";
import { AliCloudApi } from "../../alicloud/index";
import { parseSearchPage, SearchPageRules } from "../searchPage";
import { SearchScanError } from "../searchScan";

export const MERCARI_FETCH_SCRIPT = `localStorage.setItem("userPreferenceCurrencyCode", '"JPY"')`;

const itemLink = 'li[data-testid="item-cell"] a[data-testid="thumbnail-link"]';
const searchPage: SearchPageRules = {
  queryKeys: ["keyword", "sort", "order"],
  itemSelector: `#item-grid ${itemLink}, [data-testid="search-item-grid"] ${itemLink}, ${itemLink}[data-location^="search_result:"][data-location*=":item_list:"]`,
  emptySelector: 'main p, main h2, main h3, [data-testid="search-no-results"], #item-grid p',
  emptyTexts: ["該当する商品が見つかりませんでした", "該当する商品がありません", "該当する商品はありません"],
};

function readPrice(cell: Element): string | null {
  const node = cell.querySelector('[data-testid="item-tile-price"]')
    || cell.querySelector('.merPrice')
    || cell.querySelector('.number, [class^="number__"], [class*=" number__"]');
  const display = node?.textContent?.trim().replace(/\s+/g, " ");
  if (!display) return null;
  const yen = display.match(/^(?:現在\s*)?[¥￥]?\s*(\d+(?:,\d{3})*)$/);
  if (yen) return yen[1].replace(/,/g, "");
  // Retain the currency shown by Mercari for localized or annotated prices.
  const hasCurrency = /\p{Sc}|円|^[A-Z]{3}\s*[\d,.]+$|^[\d,.]+\s*[A-Z]{3}$/u.test(display);
  return display.length <= 120 && /\d/.test(display) && hasCurrency ? display : null;
}

@Provide()
@Scope(ScopeEnum.Request, {
  allowDowngrade: true,
})
export class MercariApi extends ApiBase {

  @Logger()
  logger: ILogger;

  @Inject()
  alicloudApi: AliCloudApi;

  async fetchGoodsList(searchOptions: MercariGoodsSearchCondition): Promise<GoodsListResponse> {
    const { keyword } = searchOptions;
    // We only keep `keyword` as per the spec.
    const targetUrl = `https://jp.mercari.com/search?keyword=${encodeURIComponent(keyword)}&order=desc&sort=created_time`;

    const fetchPage = (attempts: number) => this.alicloudApi.fetchHtmlViaServerless(
      targetUrl, 'data-testid="thumbnail-link"', [], 30, attempts, MERCARI_FETCH_SCRIPT, searchPage
    );
    let resp = await fetchPage(2);
    if (resp?.success === false && resp.cloudflare_detected === false &&
        /^Page\.goto:\s+net::ERR_CONNECTION_(?:CLOSED|RESET)\b/.test(resp.error || "")) {
      // Reserve the last of the three attempts for a brief network interruption.
      this.logger.warn("Mercari connection interrupted, retrying in 30 seconds");
      await new Promise(resolve => setTimeout(resolve, 30_000));
      resp = await fetchPage(1);
    }

    return parseSearchPage(resp, targetUrl, searchPage, (_document, state, links) => {
      if (state === "empty") return { items: [] };
      const items = new Map<string, GoodsListResponse["items"][number]>();
      let missingNames = 0;
      for (const link of links) {
        const cell = link.closest('li[data-testid="item-cell"]');
        const href = link.getAttribute("href") || "";
        const id = href.match(/^\/(?:item|shops\/product)\/([a-zA-Z0-9]+)(?:[?#]|$)/)?.[1];
        if (!id) continue;

        const image = cell.querySelector("img");
        const name = cell.querySelector('[data-testid="thumbnail-item-name"]')?.textContent?.trim()
          || image?.getAttribute("alt")?.trim();
        if (!name) {
          missingNames++;
          continue;
        }

        const price = readPrice(cell);
        const previous = items.get(id);
        if (previous && (previous.price !== null || price === null)) continue;

        const sold = cell.querySelector('div[role="img"][data-testid="thumbnail-sticker"][aria-label="売り切れ"]')
          || cell.querySelector('[data-testid="item-tile-sticker"]')?.textContent?.trim() === "SOLD";
        const thumbnail = image?.getAttribute("src");
        items.set(id, {
          id, name, price,
          url: `https://jp.mercari.com${href}`,
          status: sold ? "STATUS_SOLD_OUT" : "STATUS_ON_SALE",
          thumbnails: thumbnail ? [thumbnail] : [],
          updated: "0",
        });
      }
      if (!items.size) {
        throw new SearchScanError("INVALID_ITEMS", missingNames
          ? `Mercari item markup is incomplete: ${missingNames} cards without names`
          : "Mercari page has no recognizable items; empty or unfinished markup");
      }
      const results = Array.from(items.values());
      const missingPrices = results.filter(item => item.price === null).length;
      if (missingNames || missingPrices) {
        this.logger.warn(`Mercari scan kept ${results.length} items (${missingPrices} without prices), skipped ${missingNames} unnamed cards`);
      }
      return { items: results };
    });
  }

  async fetchGoodDetail(searchOptions: { id: string }) {
    // TODO do not consider about fetch good detail for now
      return {} as any;
  }
}
