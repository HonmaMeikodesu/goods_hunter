import { Provide, Inject, Logger, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ProxyGet, ProxyPost } from "../../request";
import { ILogger } from "@midwayjs/logger";
import generateJwt from "generate-mercari-jwt";
import { GoodsListResponse, MercariGoodsSearchCondition } from "./types";
import { v4 } from "uuid";

const MERCARIHOST = "api.mercari.jp";

@Provide()
@Scope(ScopeEnum.Request, {
  allowDowngrade: true,
})
export class MercariApi {
  @Inject("proxyGet")
  proxyGet: ProxyGet;

  @Inject("proxyPost")
  proxyPost: ProxyPost;

  @Logger()
  logger: ILogger;

  async fetchGoodsList(searchOptions: MercariGoodsSearchCondition) {
    const mercariSearchUrl = "https://api.mercari.jp/v2/entities:search";
    const jwt = await generateJwt(mercariSearchUrl, "POST");
    const { pageSize, ...rest } = searchOptions;
    return this.proxyPost<GoodsListResponse>(mercariSearchUrl, {
      "X-Platform": "web",
      DPoP: jwt,
    }, {
      pageSize: pageSize || 20,
      searchSessionId: v4(),
      searchCondition: {
        sort: "SORT_CREATED_TIME",
        order: "ORDER_DESC",
        ...rest,
      },
      defaultDatasets: [
        "DATASET_TYPE_MERCARI",
        "DATASET_TYPE_BEYOND"
      ],
      serviceFrom: "suruga",
      withItemBrand: true,
      withItemSize: false,
      withItemPromotions: true,
      withItemSizes: true,
      withShopname: false
    });
  }

  async fetchThumbNailsAndConvertToBase64(url: string) {
    const imgArrayBuffer: any = await this.proxyGet(
      url,
      {},
      { responseType: "arraybuffer" }
    );
    const base64Url = Buffer.from(imgArrayBuffer, "binary").toString("base64");
    return `data:image/jpg;base64,${base64Url}`;
  }
}
