import { IMidwayContainer, providerWrapper } from "@midwayjs/core";
import { HttpService } from "@midwayjs/axios";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { proxyInbound } from "../const";
import { ScopeEnum } from "@midwayjs/decorator";
const HttpsProxyAgent = require("https-proxy-agent");

export declare interface ProxyGet {
  <T>(
    url: string,
    headers?: AxiosRequestConfig["headers"],
    otherOptions?: Omit<AxiosRequestConfig, "headers">
  ): Promise<T>;
}
export function proxyGet<T>(container: IMidwayContainer) {
  return async (
    url: string,
    headers?: AxiosRequestConfig["headers"],
    otherOptions?: Omit<AxiosRequestConfig, "headers">
  ) => {
    const httpService = await container.getAsync<HttpService>(HttpService);
    const httpsAgent = new HttpsProxyAgent(proxyInbound);
    const resp = await httpService.get<T>(encodeURI(url), {
      headers,
      httpsAgent,
      proxy: false,
      ...otherOptions,
    });
    return resp.data;
  };
}

providerWrapper([
  {
    id: "proxyGet",
    provider: proxyGet,
    scope: ScopeEnum.Singleton,
  },
]);
