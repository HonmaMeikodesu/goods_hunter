import { IMidwayContainer, providerWrapper } from '@midwayjs/core';
import { HttpService } from '@midwayjs/axios';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { proxyInbound } from '../const';
const HttpsProxyAgent = require('https-proxy-agent');

export declare interface ProxyGet {
  (url: string, headers?: Record<string, string>): Promise<AxiosResponse<any>>;
}
export function proxyGet(container: IMidwayContainer) {
  return async (url: string, headers?: AxiosRequestConfig['headers']) => {
    const httpService = await container.getAsync<HttpService>(HttpService);
    const httpsAgent = new HttpsProxyAgent(proxyInbound);
    return httpService
      .get(url, {
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
