import { IMidwayContainer, providerWrapper } from "@midwayjs/core";
import { HttpService } from "@midwayjs/axios";
import { AxiosRequestConfig } from "axios";
import { proxyInbound } from "../const";
import { ScopeEnum } from "@midwayjs/decorator";
import doThisUntilResolve from "../../utils/doThisUntilResolve";
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
    const resp = await doThisUntilResolve(() => httpService.get<T>(encodeURI(url), {
      headers,
      httpsAgent,
      proxy: false,
      ...otherOptions,
    }), 10);
    return resp.data;
  };
}

export declare interface ProxyPost {
  <T>(
    url: string,
    headers?: AxiosRequestConfig["headers"],
    body?: any,
    otherOptions?: Omit<AxiosRequestConfig, "headers">
  ): Promise<T>;
}
export function proxyPost<T>(container: IMidwayContainer) {
  return async (
    url: string,
    headers?: AxiosRequestConfig["headers"],
    body?: any,
    otherOptions?: Omit<AxiosRequestConfig, "headers">
  ) => {
    const httpService = await container.getAsync<HttpService>(HttpService);
    const httpsAgent = new HttpsProxyAgent(proxyInbound);
    const resp = await doThisUntilResolve(() => httpService.post<T>(encodeURI(url), body, {
      headers,
      httpsAgent,
      proxy: false,
      ...otherOptions,
    }), 10);
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

providerWrapper([
  {
    id: "proxyPost",
    provider: proxyPost,
    scope: ScopeEnum.Singleton,
  },
]);
