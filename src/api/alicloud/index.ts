import { Provide, Config, Logger } from "@midwayjs/decorator";
import util from "@alicloud/openapi-util";
import axios from "axios";
import { ILogger } from "@midwayjs/logger";

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
export class AliCloudApi {
  @Config("alicloudConfig")
  alicloudConfig: {
    accessKeyId: string;
    accessKeySecret: string;
    url: string;
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

    const method = 'POST';
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
      this.logger.info(`Requesting Serverless FC target_url: ${targetUrl}`);
      const resp = await axios.post(url, body, {
        headers: headers,
        timeout: 120000, // 120s timeout for browser rendering
      });
      return resp.data as FetchHtmlViaServerlessResponse;
    } catch (e) {
      this.logger.error(`Error requesting Serverless FC for ${targetUrl}: ${e}`);
      throw e;
    }
  }
}
