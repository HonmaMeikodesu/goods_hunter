import { Provide, Inject, Logger, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ProxyPost } from "../../request";
import { ILogger } from "@midwayjs/logger";
import generateJwt from "generate-mercari-jwt";
import { GoodDetailResponse, GoodsListResponse, MercariGoodsSearchCondition } from "./types";
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

  async fetchGoodDetail(searchOptions: { id: string }) {
      const { id  } = searchOptions;
      const mercariDetailUrl = `https://api.mercari.jp/items/get?id=${id}`
          const jwt = await generateJwt(mercariDetailUrl, "POST");
      const res =await this.proxyGet<GoodDetailResponse>(mercariDetailUrl, {
          "X-Platform": "web",
          DPoP: jwt,
      });
      if (res.result === "InvisibleItemException") {
        // @ts-expect-error pass
        res.data = {
          status: "sold_out"
        }
        return res.data;
      }
      if (res.result !== "OK") {
          throw new Error(`Unable to fetch mercari good detail of {${id}}, ${JSON.stringify(res)}`
                         );
      }
      return res.data;
  }
}


