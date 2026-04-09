import { Provide, Inject, Logger, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { GoodsListResponse, MercariGoodsSearchCondition } from "./types";
import { ApiBase } from "../base";
import { AliCloudApi } from "../../alicloud/index";

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
        "merItemThumbnail",
        [],
        undefined,
        3,
        `localStorage.setItem("userPreferenceCurrencyCode", '"JPY"')`
      );
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
    const grid = document.querySelector('div[id="item-grid"]');
    if (grid) {
      const cells = grid.querySelectorAll('li[data-testid="item-cell"]');
      cells.forEach((cell: Element) => {
        const linkElem = cell.querySelector('a[data-testid="thumbnail-link"]');
        const imgElem = cell.querySelector('img');
        const priceElem = cell.querySelector('[class*="number"]'); // price number
        
        // Find sold out sticker
        const soldElem = cell.querySelector('div[role="img"][data-testid="thumbnail-sticker"][aria-label="売り切れ"]');
        const isSold = !!soldElem;

        if (linkElem) {
          const href = linkElem.getAttribute("href") || "";
          const match = href.match(/item\/(m\d+)/);
          const id = match ? match[1] : href.split('/').pop();
          
          if (id) {
            items.push({
              id,
              name: imgElem ? (imgElem.getAttribute("alt") || "") : "", // Get title from image alt
              price: priceElem ? priceElem.textContent?.trim() : "0",
              status: isSold ? "STATUS_SOLD_OUT" : "STATUS_ON_SALE",
              thumbnails: imgElem ? [imgElem.getAttribute("src")] : [],
              updated: "0" // Mock update field temporarily for type safety; not used anymore
            });
          }
        }
      });
    }

    return { items } as any;
  }

  async fetchGoodDetail(searchOptions: { id: string }) {
    // TODO do not consider about fetch good detail for now
      return {} as any;
  }
}


