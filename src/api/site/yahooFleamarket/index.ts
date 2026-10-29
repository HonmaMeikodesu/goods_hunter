import { Inject, Provide, Scope, ScopeEnum } from "@midwayjs/decorator";
import { AliCloudApi } from "../../alicloud";
import { ApiBase } from "../base";
import { normalizeYahooFleamarketCondition } from "./conditions";
import { YahooFleamarketGoods, YahooFleamarketSearchCondition } from "./types";

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export class YahooFleamarketApi extends ApiBase {
  @Inject()
  alicloudApi: AliCloudApi;

  async fetchGoodsList(options: YahooFleamarketSearchCondition): Promise<YahooFleamarketGoods[]> {
    const condition = normalizeYahooFleamarketCondition(options);
    const goods = new Map<string, YahooFleamarketGoods>();
    for (let page = 1; page <= condition.epoch; page++) {
      const result = await this.alicloudApi.fetchYahooFleamarketPage({ keyword: condition.keyword, page, onSaleOnly: true });
      if (!result || result.success !== true || result.source !== "yahooFleamarket"
        || result.keyword !== condition.keyword || result.page !== page || result.offset !== (page - 1) * 100
        || !Array.isArray(result.items) || result.items.length > 100
        || !Number.isSafeInteger(result.totalResultsAvailable) || result.totalResultsAvailable < 0) {
        throw new Error("Yahoo!フリマ FC returned an invalid search response");
      }
      for (const good of result.items) {
        if (!good || typeof good.id !== "string" || !good.id || good.id.length > 200
          || typeof good.name !== "string" || !good.name.trim() || !Number.isSafeInteger(good.price) || good.price < 0
          || typeof good.status !== "string") {
          throw new Error("Yahoo!フリマ FC returned invalid merchandise");
        }
        if (good.status !== "OPEN"
          || (condition.minPrice !== undefined && good.price < condition.minPrice)
          || (condition.maxPrice !== undefined && good.price > condition.maxPrice)
          || condition.excludeKeywords.some(word => good.name.toLowerCase().includes(word))) continue;
        // Derive the trusted link locally; do not embed arbitrary FC links in email.
        goods.set(good.id, {
          ...good,
          itemUrl: `https://paypayfleamarket.yahoo.co.jp/item/${encodeURIComponent(good.id)}`,
          thumbnailImageUrl: typeof good.thumbnailImageUrl === "string" && /^https:\/\//.test(good.thumbnailImageUrl) ? good.thumbnailImageUrl : "",
        });
      }
      // Always scan the configured window. openTime and seen IDs cannot safely
      // act as early-stop watermarks for this marketplace.
    }
    return [...goods.values()];
  }
}
