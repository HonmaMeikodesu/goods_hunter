import { Provide, Inject, Logger, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { GoodsListResponse, MercariGoodsSearchCondition } from "./types";
import { ApiBase } from "../base";
import { AliCloudApi } from "../../alicloud/index";

export const MERCARI_FETCH_SCRIPT = `localStorage.setItem("userPreferenceCurrencyCode", '"JPY"')`;

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
    
    
    let html: string;
    try {
      const resp = await this.alicloudApi.fetchHtmlViaServerless(
        targetUrl,
        'data-testid="thumbnail-link"',
        [],
        30,
        3,
        MERCARI_FETCH_SCRIPT
      );
      if (!resp.success || !resp.content) {
        throw new Error("Mercari page fetch failed");
      }
      html = resp.content;
    } catch (e) {
      this.logger.error("Failed to fetch mercari from Serverless FC", e);
      throw e;
    }

    const { JSDOM } = require("jsdom");
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const items: any[] = [];
    
    // Find item grid and goods
    const seen = new Set<string>();
    try {
      const cells = document.querySelectorAll('li[data-testid="item-cell"]');
      cells.forEach((cell: Element) => {
        const linkElem = cell.querySelector('a[data-testid="thumbnail-link"]');
        const imgElem = cell.querySelector('img');
        const priceElem = cell.querySelector('[data-testid="item-tile-price"], [class*="number"]');
        
        // Find sold out sticker
        const soldElem = cell.querySelector('div[role="img"][data-testid="thumbnail-sticker"][aria-label="売り切れ"]');
        const isSold = !!soldElem || cell.querySelector('[data-testid="item-tile-sticker"]')?.textContent?.trim() === "SOLD";

        if (linkElem) {
          const href = linkElem.getAttribute("href") || "";
          const match = href.match(/^\/(?:item|shops\/product)\/([a-zA-Z0-9]+)(?:[?#]|$)/);
          const id = match?.[1];
          
          if (id && !seen.has(id)) {
            const name = cell.querySelector('[data-testid="thumbnail-item-name"]')?.textContent?.trim() || imgElem?.getAttribute("alt") || "";
            const price = priceElem?.textContent?.trim().replace(/^現在\s*/, "").replace(/[¥￥,\s]/g, "");
            if (!name || !price || !/^\d+$/.test(price)) {
              throw new Error(`Mercari item markup is incomplete: ${id}`);
            }
            seen.add(id);
            items.push({
              id,
              url: `https://jp.mercari.com${href}`,
              name,
              price,
              status: isSold ? "STATUS_SOLD_OUT" : "STATUS_ON_SALE",
              thumbnails: imgElem ? [imgElem.getAttribute("src")] : [],
              updated: "0" // Mock update field temporarily for type safety; not used anymore
            });
          }
        }
      });
      if (!items.length) {
        throw new Error("Mercari page has no recognizable items; empty or unfinished markup");
      }
      return { items } as any;
    } finally {
      dom.window.close();
    }
  }

  async fetchGoodDetail(searchOptions: { id: string }) {
    // TODO do not consider about fetch good detail for now
      return {} as any;
  }
}
