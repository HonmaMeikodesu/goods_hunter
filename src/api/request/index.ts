import { IMidwayContainer, providerWrapper } from "@midwayjs/core";
import { HttpService } from "@midwayjs/axios";
import { AxiosRequestConfig } from "axios";
import { proxyInbound } from "../const";
import { ScopeEnum } from "@midwayjs/decorator";
import doThisUntilResolve from "../../utils/doThisUntilResolve";
import { isNumber } from "lodash";
const HttpsProxyAgent = require("https-proxy-agent");

type RequestCustomOptions = Omit<AxiosRequestConfig, "headers"> & { maxRetry?: { count: number, breakOnCondition?: (e: any) => boolean } }

export declare interface ProxyGet {
  <T>(
    url: string | URL,
    headers?: AxiosRequestConfig["headers"],
    otherOptions?: RequestCustomOptions
  ): Promise<T>;
}
export function proxyGet<T>(container: IMidwayContainer) {
  return async (
    url: string | URL,
    headers?: AxiosRequestConfig["headers"],
    otherOptions?: RequestCustomOptions
  ) => {
    const httpService = await container.getAsync<HttpService>(HttpService);
    const httpsAgent = new HttpsProxyAgent(proxyInbound);
    const resp = await doThisUntilResolve(() => httpService.get<T>(url instanceof URL ? url.toString() : encodeURI(url), {
      headers,
      httpsAgent,
      proxy: false,
      timeout: 5 * 1000,
      ...otherOptions,
    }), isNumber(otherOptions?.maxRetry?.count) ? otherOptions.maxRetry.count : 2, undefined, otherOptions?.maxRetry?.breakOnCondition);
    return resp.data;
  };
}

export declare interface ProxyPost {
  <T>(
    url: string | URL,
    headers?: AxiosRequestConfig["headers"],
    body?: any,
    otherOptions?: RequestCustomOptions
  ): Promise<T>;
}
export function proxyPost<T>(container: IMidwayContainer) {
  return async (
    url: string | URL,
    headers?: AxiosRequestConfig["headers"],
    body?: any,
    otherOptions?: RequestCustomOptions
  ) => {
    const httpService = await container.getAsync<HttpService>(HttpService);
    const httpsAgent = new HttpsProxyAgent(proxyInbound);
    const resp = await doThisUntilResolve(() => httpService.post<T>(url instanceof URL ? url.toString() : encodeURI(url), body, {
      headers,
      httpsAgent,
      proxy: false,
      timeout: 5 * 1000,
      ...otherOptions,
    }), isNumber(otherOptions?.maxRetry?.count) ? otherOptions.maxRetry.count : 5, undefined, otherOptions?.maxRetry?.breakOnCondition);
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




