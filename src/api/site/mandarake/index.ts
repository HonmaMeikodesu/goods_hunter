import { Provide, Inject, Logger, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { ApiBase } from "../base";
import { AliCloudApi } from "../../alicloud/index";
import { GoodsListResponse, MandarakeGoodsSearchCondition } from "./types";

@Provide()
@Scope(ScopeEnum.Request, {
  allowDowngrade: true,
})
export class MandarakeApi extends ApiBase {

  @Logger()
  logger: ILogger;

  @Inject()
  alicloudApi: AliCloudApi;

  async fetchGoodsList(searchOptions: MandarakeGoodsSearchCondition): Promise<GoodsListResponse> {
    const { keyword, page = 1 } = searchOptions;
    const targetUrl = `https://order.mandarake.co.jp/order/listPage/list?page=${page}&layout=0&keyword=${encodeURIComponent(keyword)}&deviceId=1`;

    let html: string;
    try {
      const resp = await this.alicloudApi.fetchHtmlViaServerless(
        targetUrl,
        "entry", // page_loaded_assertion
        [
          {
            name: "_ga",
            value: "0",
            domain: "order.mandarake.co.jp",
            path: "/",
          },
          {
            name: "_gat",
            value: "0",
            domain: "order.mandarake.co.jp",
            path: "/",
          },
          {
            name: "_gid",
            value: "0",
            domain: "order.mandarake.co.jp",
            path: "/",
          },
          {
            name: "mandarake_url",
            value: "0",
            domain: "order.mandarake.co.jp",
            path: "/",
          },
          {
            name: "tr_mndrk_user",
            value: "0",
            domain: "order.mandarake.co.jp",
            path: "/"
          }
        ],
        undefined,
        3
      );
      html = resp.content;
    } catch (e) {
      this.logger.error("Failed to fetch mandarake from Serverless FC", e);
      throw e;
    }

    const { JSDOM } = require("jsdom");
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const items: any[] = [];

    const goodsBlocks = document.querySelectorAll(".entry .thumlarge .block");
    goodsBlocks.forEach((block: Element) => {
      // Filter out sold out items
      const soldOutElem = block.querySelector(".soldout");
      if (soldOutElem) {
        return;
      }

      const thumbElem = block.querySelector(".thum img");
      const titleElem = block.querySelector(".title a");
      const priceElem = block.querySelector(".price p");

      if (titleElem) {
        const title = titleElem.textContent?.trim() || "";
        // Priority: data-itemidx on block > id on title anchor > itemCode in href
        let id = block.getAttribute("data-itemidx") || titleElem.getAttribute("id") || "";

        if (!id || id === "#adult_confirm") {
          const href = titleElem.getAttribute("href") || "";
          const idMatch = href.match(/itemCode=(\d+)/);
          if (idMatch) {
            id = idMatch[1];
          }
        }

        // Final check to avoid using #adult_confirm or empty string as ID
        if (!id || id.startsWith("#")) {
          return;
        }

        const thumb = thumbElem ? (thumbElem.getAttribute("data-src") || thumbElem.getAttribute("src") || "") : "";
        const price = priceElem ? priceElem.textContent?.trim().split('\n')[0].trim() : "0";

        items.push({
          id,
          name: title,
          price: price,
          thumbnails: thumb ? [thumb] : [],
        });
      }
    });

    return { items } as any;
  }

  async fetchGoodDetail(searchOptions: { id: string }) {
      return {} as any;
  }
}
