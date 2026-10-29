// Explicit operator command. Reads local secrets but prints only a result code.
require('ts-node/register');
const { readFileSync } = require('fs');
const path = require('path');
const { AliCloudApi } = require('../../src/api/alicloud');
const { YahooAuctionApi } = require('../../src/api/site/yahoo');

(async () => {
  if (!process.env.YAHOO_SESSION_FILE) throw new Error('YAHOO_SESSION_FILE_REQUIRED');
  const fc = new AliCloudApi();
  fc.alicloudConfig = JSON.parse(readFileSync(path.resolve(__dirname, '../../src/private/alicloud.json'), 'utf8'));
  fc.logger = { info() {}, error() {} };
  const api = new YahooAuctionApi();
  api.alicloudApi = fc;
  api.sessionConfig = { file: process.env.YAHOO_SESSION_FILE,
    maxAgeSeconds: Number(process.env.YAHOO_SESSION_MAX_AGE_SECONDS || 21600),
    authenticatedSelector: process.env.YAHOO_AUTH_SELECTOR };
  const result = await api.checkCookieHeartBeat();
  console.log(JSON.stringify(result));
  process.exitCode = result.result ? 0 : 1;
})().catch(() => { console.error('Yahoo FC session check could not run; check local configuration.'); process.exitCode = 1; });
