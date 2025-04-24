import { Provide, Inject, Logger, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ProxyPost } from "../../request";
import { ILogger } from "@midwayjs/logger";
import generateJwt from "generate-mercari-jwt";
import { GoodsListResponse, MercariGoodsSearchCondition } from "./types";
import { v4 } from "uuid";
import { ApiBase } from "../base";

@Provide()
@Scope(ScopeEnum.Request, {
  allowDowngrade: true,
})
export class MercariApi extends ApiBase {

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

  async fetchGoodDetail(searchOptions: any): Promise<any> {
      return Promise.resolve();
  }
}



