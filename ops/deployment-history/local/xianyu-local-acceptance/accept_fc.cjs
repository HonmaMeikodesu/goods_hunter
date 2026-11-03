const path = require('path');
const fs = require('fs');
const repo = '/home/admin/project/goods_hunter';
require(path.join(repo, 'node_modules/ts-node')).register({ project: path.join(repo, 'tsconfig.json'), transpileOnly: true });
const { AliCloudApi } = require(path.join(repo, 'src/api/alicloud'));
const { XianyuApi } = require(path.join(repo, 'src/api/site/xianyu'));
(async () => {
  const fc = new AliCloudApi();
  fc.alicloudConfig = { accessKeyId: 'local-test-id', accessKeySecret: 'local-test-secret', url: '', xianyuUrl: process.argv[2] };
  fc.logger = { info() {}, error(message) { console.error(message); } };
  const api = new XianyuApi(); api.alicloudApi = fc;
  const started = Date.now();
  const items = await api.fetchGoodsList({ keyword: '初音未来', includeKeywords: ['初音'], maxPrice: 500 });
  if (!items.length || items.some(i => i.priceFen > 50000 || !i.name.includes('初音'))) throw new Error('Keyword/price filter failed');
  const report = { keyword: '初音未来', elapsedSeconds: (Date.now() - started) / 1000, itemCount: items.length, items };
  fs.writeFileSync('/home/admin/Documents/Codex/2026-11-02/new-chat-2/outputs/xianyu-goods-hunter-acceptance.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ stage: 'goods_hunter signed client + filters', items: items.length, seconds: report.elapsedSeconds }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
