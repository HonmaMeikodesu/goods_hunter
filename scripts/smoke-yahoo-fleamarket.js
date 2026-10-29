const { readFileSync } = require("fs");
const path = require("path");
const { AliCloudApi } = require("../src/api/alicloud");
const { YahooFleamarketApi } = require("../src/api/site/yahooFleamarket");

async function main() {
  const config = JSON.parse(readFileSync(path.join(__dirname, "../src/private/alicloud.json"), "utf-8"));
  config.yahooFleamarketUrl = process.env.YAHOO_FLEAMARKET_FC_URL || config.yahooFleamarketUrl;
  const fc = new AliCloudApi();
  fc.alicloudConfig = config;
  fc.logger = { info: () => undefined, error: message => process.stderr.write(message + "\n") };
  const api = new YahooFleamarketApi();
  api.alicloudApi = fc;
  const goods = await api.fetchGoodsList({ keyword: process.argv[2] || "缶バッジ", epoch: 1 });
  process.stdout.write(JSON.stringify({ success: true, count: goods.length, statuses: [...new Set(goods.map(item => item.status))] }) + "\n");
}

main().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
