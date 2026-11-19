import { Provide, Inject, Logger, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { ApiBase } from "../base";
import { AliCloudApi } from "../../alicloud/index";
import { GoodsListResponse, MandarakeGoodsSearchCondition } from "./types";
import { parseSearchPage, SearchPageRules } from "../searchPage";
import { SearchScanError } from "../searchScan";

const searchPage: SearchPageRules = {
  queryKeys: ["keyword", "page"],
  queryDefaults: { page: "1" },
  itemSelector: ".entry .thumlarge .block",
  emptySelector: ".list_nav__count, .entry p, .entry h2, .entry .notice",
  emptyTexts: ["検索結果0", "検索結果0件", "該当する商品がありません", "該当する商品はありません", "該当する商品が見つかりませんでした"],
};

export const MANDARAKE_FETCH_COOKIES = [
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
];

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

    const resp = await this.alicloudApi.fetchHtmlViaServerless(
      targetUrl, "entry", MANDARAKE_FETCH_COOKIES, undefined, 3, undefined, searchPage
    );
    return parseSearchPage(resp, targetUrl, searchPage, (_document, _state, blocks) => {
      const items: GoodsListResponse["items"] = [];
      for (const block of blocks) {
        const title = block.querySelector(".title a");
        const name = title?.textContent?.trim();
        let id = block.getAttribute("data-itemidx") || title?.getAttribute("id");
        if (!id || id === "#adult_confirm") {
          id = title?.getAttribute("href")?.match(/itemCode=(\d+)/)?.[1];
        }
        if (!id || id.startsWith("#") || !name) {
          throw new SearchScanError("INVALID_ITEMS", "Mandarake product markup is incomplete");
        }
        // A readable list of sold listings still proves a successful search.
        if (block.querySelector(".soldout")) continue;
        const thumbnail = block.querySelector(".thum img");
        const thumb = thumbnail?.getAttribute("data-src") || thumbnail?.getAttribute("src");
        items.push({
          id,
          name,
          price: block.querySelector(".price p")?.textContent?.trim().split("\n")[0].trim() || "0",
          thumbnails: thumb ? [thumb] : [],
        });
      }
      return { items };
    });
  }

  async fetchGoodDetail(searchOptions: { id: string }) {
      return {} as any;
  }
}
