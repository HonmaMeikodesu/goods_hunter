import { IMidwayContainer, providerWrapper } from '@midwayjs/core';
import { HttpService } from '@midwayjs/axios';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { proxyInbound } from '../const';
const HttpsProxyAgent = require('https-proxy-agent');

export declare interface ProxyGet {
  <T>(url: string, headers?: Record<string, string>): Promise<AxiosResponse<T>>;
}
export function proxyGet<T>(container: IMidwayContainer) {
  return async (url: string, headers?: AxiosRequestConfig['headers']) => {
    const httpService = await container.getAsync<HttpService>(HttpService);
    const httpsAgent = new HttpsProxyAgent(proxyInbound);
    return httpService
      .get<T>(url, {
        headers,
        httpsAgent,
        proxy: false,
      });
  };
}

providerWrapper([
  {
    id: 'proxyGet',
    provider: proxyGet,
  },
]);
