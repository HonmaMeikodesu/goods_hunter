import { Provide, Inject, Logger, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ProxyGet } from "../../request";
import { ILogger } from "@midwayjs/logger";
import generateJwt from "generate-mercari-jwt";
import { GoodsListResponse } from "./types";

const MERCARIHOST = "api.mercari.jp";

@Provide()
@Scope(ScopeEnum.Request, {
  allowDowngrade: true,
})
export class MercariApi {
  @Inject("proxyGet")
  proxyGet: ProxyGet;

  private DPoP: string;

  @Logger()
  logger: ILogger;

  async fetchGoodsList(url: string) {
    const urlObj = new URL(url);
    const jwt = await generateJwt("https://api.mercari.jp/search_index/search");
    if (urlObj.host !== MERCARIHOST)
      throw new Error("Unexpected Host Name, expected Mercari");
    return this.proxyGet<GoodsListResponse>(url, {
      "X-Platform": "web",
      DPoP: jwt,
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
