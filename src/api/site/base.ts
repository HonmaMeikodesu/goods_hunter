
import { Provide, Inject, Logger, ScopeEnum, Scope } from "@midwayjs/decorator";
import { ProxyGet, ProxyPost } from "../request";
import { ILogger } from "@midwayjs/logger";
import { ReadStream } from "fs";

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export abstract class ApiBase {
  @Inject("proxyGet")
  proxyGet: ProxyGet;

  @Inject("proxyPost")
  proxyPost: ProxyPost;

  @Logger()
  logger: ILogger;

  abstract fetchGoodsList(searchOptions: any): Promise<any>

  async fetchThumbNail(url: string): Promise<ReadStream> {
    const imgStream = await this.proxyGet<ReadStream>(
      url,
      {},
      { responseType: "stream" }
    );
    return imgStream;
  }

}



