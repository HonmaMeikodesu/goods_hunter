import { Inject, Provide, Scope, ScopeEnum } from "@midwayjs/decorator";
import { AliCloudApi } from "../../alicloud";
import { ApiBase } from "../base";
import { normalizeXianyuCondition, yuanToFen } from "./conditions";
import { XianyuGoods, XianyuSearchCondition } from "./types";

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export class XianyuApi extends ApiBase {
  @Inject()
  alicloudApi: AliCloudApi;

  async fetchGoodsList(options: XianyuSearchCondition): Promise<XianyuGoods[]> {
    const condition = normalizeXianyuCondition(options);
    const result = await this.alicloudApi.fetchXianyuSearch({ keyword: condition.keyword });
    if (!result || result.success !== true || result.source !== "xianyu" || result.keyword !== condition.keyword
      || result.page !== 1 || result.pageSize !== 30 || result.sort !== "newest" || result.currency !== "CNY"
      || typeof result.hasMore !== "boolean" || !Array.isArray(result.items) || result.items.length > 30
      || result.resultState !== (result.items.length ? "items" : "empty")) {
      throw new Error("闲鱼 FC returned an invalid search response");
    }
    const goods = new Map<string, XianyuGoods>();
    const minFen = condition.minPrice === undefined ? undefined : yuanToFen(condition.minPrice);
    const maxFen = condition.maxPrice === undefined ? undefined : yuanToFen(condition.maxPrice);
    for (const good of result.items) {
      if (!good || typeof good.id !== "string" || !/^[0-9]{1,30}$/.test(good.id)
        || typeof good.name !== "string" || !good.name.trim() || !Number.isSafeInteger(good.priceFen) || good.priceFen < 0
        || (good.publishedAt !== null && (typeof good.publishedAt !== "string" || !Number.isFinite(Date.parse(good.publishedAt))))) {
        throw new Error("闲鱼 FC returned invalid merchandise");
      }
      const title = good.name.toLowerCase();
      if ((minFen !== undefined && good.priceFen < minFen) || (maxFen !== undefined && good.priceFen > maxFen)
        || condition.excludeKeywords.some(word => title.includes(word))
        || !condition.includeKeywords.every(word => title.includes(word))) continue;
      goods.set(good.id, {
        id: good.id, name: good.name, priceFen: good.priceFen, publishedAt: good.publishedAt,
        itemUrl: `https://www.goofish.com/item?id=${good.id}`,
        thumbnailImageUrl: typeof good.thumbnailImageUrl === "string" && /^https:\/\//.test(good.thumbnailImageUrl) ? good.thumbnailImageUrl : "",
      });
    }
    return [...goods.values()];
  }
}
