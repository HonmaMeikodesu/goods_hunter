import { IMidwayContainer, providerWrapper } from "@midwayjs/core";
import { Configuration, App, Inject } from "@midwayjs/decorator";
import { HttpService } from "@midwayjs/axios";
import { AxiosRequestConfig } from "axios";
const HttpsProxyAgent = require('https-proxy-agent');

export function proxyGet(container: IMidwayContainer) {
    return async (url: string, headers?: AxiosRequestConfig) => {
        const httpService = await container.getAsync<HttpService>(HttpService);
        const agent = new HttpsProxyAgent('http://localhost:1218');
        httpService
            .get(
            url,
            {
                ...head
            }
            )
            .then(data => {
            process.stdout.write(data.data);
            })
    }
}

providerWrapper([{
    id: "proxyGet",
    provider: proxyGet,
}]);