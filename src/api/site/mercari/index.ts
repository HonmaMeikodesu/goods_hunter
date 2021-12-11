import { Provide, Inject, Scope, ScopeEnum, TaskLocal, Logger, Init } from "@midwayjs/decorator";
import { ProxyGet } from "../../request";
import { ILogger } from "@midwayjs/logger";

const MERCARIHOST = "api.mercari.jp";

@Provide()
@Scope(ScopeEnum["Singleton"])
export class MercariApi {

  @Init()
  async init() {
    await this.refreshTicket();
  }

  @Inject("proxyGet")
  proxyGet: ProxyGet;

  private DPoP: string;

  @Inject()
  logger: ILogger;N

  @TaskLocal("* * * * * *")
  protected async refreshTicket() {

  }

  async fetchGoodsList(url: string) {
    const urlObj = new URL(url);
    if (urlObj.host !== MERCARIHOST) throw new Error("Unexpected Host Name, expected Mercari");
    this.proxyGet<string>("https://api.mercari.jp/search_index/search?sort=score&order=desc&limit=120&keyword=anohana&status=on_sale&page=0", {
      "X-Platform": "web",
      "DPoP": ""
    })
  }
}