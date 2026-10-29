import { Provide, Config, Logger, Scope, ScopeEnum } from "@midwayjs/decorator";
import util from "@alicloud/openapi-util";
import axios from "axios";
import { Agent as HttpAgent } from "http";
import { Agent as HttpsAgent } from "https";
import { ILogger } from "@midwayjs/logger";
import { YahooFleamarketPageRequest, YahooFleamarketPageResponse } from "../site/yahooFleamarket/types";

// A function's HTTP server can close its connection after a response. Avoid
// reusing that socket for the next page (Node 22 enables keep-alive by default).
const fcHttpAgent = new HttpAgent({ keepAlive: false });
const fcHttpsAgent = new HttpsAgent({ keepAlive: false });

export interface FetchHtmlViaServerlessResponse {
  success: boolean;
  url: string;
  title: string;
  content: string;
  content_length: number;
  cookies_count: number;
  cookies: Array<{ name: string; value: string; domain: string; path: string }>;
  cloudflare_detected: boolean;
  retry_count: number;
  error?: string;
}

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export class AliCloudApi {
  @Config("alicloudConfig")
  alicloudConfig: {
    accessKeyId: string;
    accessKeySecret: string;
    url: string;
    yahooFleamarketUrl?: string;
  };

  @Logger()
  logger: ILogger;

  async fetchHtmlViaServerless(
    targetUrl: string,
    pageLoadedAssertion?: string,
    cookies?: Array<{ name: string; value: string; domain: string; path: string }>,
    maxAssertionWaitSeconds?: number,
    maxRetries?: number,
    evaluateScript?: string
  ): Promise<FetchHtmlViaServerlessResponse> {
    const { accessKeyId, accessKeySecret, url } = this.alicloudConfig;
    if (!accessKeyId || !accessKeySecret || !url) {
      throw new Error("AliCloud config is missing!");
    }

    const body: any = {
      target_url: targetUrl,
    };
    if (pageLoadedAssertion) {
      body.page_loaded_assertion = pageLoadedAssertion;
    }
    if (cookies) {
      body.cookies = cookies;
    }
    if (maxAssertionWaitSeconds !== undefined) {
      body.max_assertion_wait_seconds = maxAssertionWaitSeconds;
    }
    if (maxRetries !== undefined) {
      body.max_retries = maxRetries;
    }
    if (evaluateScript) {
      body.evaluate_script = evaluateScript;
    }

    return this.invokeFunction<FetchHtmlViaServerlessResponse>(url, body);
  }

  async fetchYahooFleamarketPage(request: YahooFleamarketPageRequest): Promise<YahooFleamarketPageResponse> {
    const url = this.alicloudConfig?.yahooFleamarketUrl;
    if (!url) throw new Error("YAHOO_FLEAMARKET_FC_URL or alicloudConfig.yahooFleamarketUrl is required");
    return this.invokeFunction<YahooFleamarketPageResponse>(url, request);
  }

  private async invokeFunction<T>(url: string, body: unknown): Promise<T> {
    const { accessKeyId, accessKeySecret } = this.alicloudConfig || {};
    if (!accessKeyId || !accessKeySecret || !url) throw new Error("AliCloud config is missing!");
    const method = "POST";
    const date = new Date().toISOString();
    const headers: Record<string, string> = {
      'x-acs-date': date,
      "content-type": "application/json",
    };

    const parsedUrl = new URL(url);
    const queryObj: Record<string, string> = {};
    parsedUrl.searchParams.forEach((val, key) => {
      queryObj[key] = val;
    });

    const authRequest: any = {
      method: method,
      protocol: parsedUrl.protocol.replace(':', ''),
      port: parsedUrl.port ? parseInt(parsedUrl.port) : (parsedUrl.protocol === 'https:' ? 443 : 80),
      pathname: parsedUrl.pathname.replace('$', '%24'),
      headers: headers,
      query: queryObj,
    };

    const auth = util.getAuthorization(
      authRequest,
      'ACS3-HMAC-SHA256',
      '',
      accessKeyId,
      accessKeySecret
    );
    headers['authorization'] = auth;

    try {
      this.logger.info(`Requesting Serverless FC: ${new URL(url).origin}`);
      const resp = await axios.post(url, body, {
        headers: headers,
        httpAgent: fcHttpAgent,
        httpsAgent: fcHttpsAgent,
        proxy: false,
        timeout: 120000, // 120s timeout for browser rendering
      });
      return resp.data as T;
    } catch (e) {
      this.logger.error(`Serverless FC request failed: ${e.message}`);
      throw e;
    }
  }
}
