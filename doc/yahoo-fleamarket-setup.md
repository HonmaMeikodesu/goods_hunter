# Yahoo!フリマ 接入与部署

本实现新增独立的 Yahoo!フリマ FC，并在 goods hunter 中注册 `YahooFleamarket` 平台。

2026-10-23 已完成云端部署和线上接入，实例地址、验证结果及回滚位置见 [上线记录](yahoo-fleamarket-deployment-2026-10-23.md)。

```text
定时任务 → YahooFleamarketApi → 签名调用专用 FC
        → FC 使用 Chrome 打开完整搜索 URL、解析商品列表
        → goods hunter 本地筛选、MySQL 去重与待发送记录、邮件提醒
```

## 1. 构建与部署专用 FC

FC 代码位于同级仓库 `../bypass-cloudflare`：

- `yahoo_fleamarket.py`：搜索 URL、页面快照校验、商品解析及浏览器生命周期。
- `code/yahoo_fleamarket_index.py`：HTTP 入口，监听 9000，支持 `POST /` 和 `POST /search`。
- `Dockerfile.yahoo-fleamarket`：复用现有 Chrome／Xvfb／Mihomo 基础镜像，独立启动新入口。
- `s.yahoo-fleamarket.yaml`：FC3 函数 `fetch-yahoo-fleamarket`，120 秒超时，实例并发 1，HTTP 签名认证。

在 FC 仓库执行：

```bash
docker build -f Dockerfile -t bypass-cloudflare:latest .
docker build -f Dockerfile.yahoo-fleamarket \
  --build-arg BASE_IMAGE=bypass-cloudflare:latest \
  -t yahoo-fleamarket-fc:dev .
```

按现有阿里云镜像仓库流程，将新镜像打上可区分的版本标签并推送；配置以下环境变量后部署新模板：

| 环境变量 | 用途 |
| --- | --- |
| `FC_ACCESS` | 已配置的 Serverless Devs 阿里云凭据别名 |
| `FC_REGION` | FC 部署地域 |
| `YAHOO_FLEAMARKET_IMAGE` | 新镜像的完整仓库地址与版本标签 |
| `GOODS_HUNTER_SERVER_URL` | 沿用现有 FC 的代理配置服务地址 |
| `SECRET_KEY_K` | 沿用现有 FC 的代理配置解密密钥，保持在部署环境中 |

```bash
s deploy -t s.yahoo-fleamarket.yaml
```

私有镜像仓库所需权限和 `registryConfig` 沿用现有部署环境配置。模板默认创建签名 HTTP 触发器，签名通过 FC 网关验证；本地直接运行的 HTTP 服务应只绑定到开发机回环端口。

FC 单次请求示例：

```json
{ "keyword": "ちいかわ 缶バッジ", "page": 1, "onSaleOnly": true }
```

FC 固定使用新着降序；页码允许 1—3，每页按当前上游 100 件分页。每页独立完整导航，校验关键词、页码、偏移量、排序和销售筛选，防止 SPA 的旧 `__NEXT_DATA__` 被当成新页。返回字段包括 `success/source/keyword/page/offset/totalResultsAvailable/items/fetchedAt`；商品字段包括 `id/name/price/status/thumbnailImageUrl/itemUrl/openTime`。

输入错误返回 400；上游拒绝或限流分别返回 403／429；抓取、数据结构错误返回 502；整体超时返回 504。遇到访问限制会返回错误。该专用采集器不自动解验证码，且不使用站内私有搜索 API。

## 2. 配置 goods hunter

在现有 `src/private/alicloud.json` 增加 `yahooFleamarketUrl`，值为新 FC HTTP 触发器 URL，根路径或 `/search` 均可。保留现有 `url`，原平台继续使用原通用 FC。沿用已有 `accessKeyId/accessKeySecret`，其权限需要涵盖新函数。

也可通过环境变量覆盖新地址：

```bash
export YAHOO_FLEAMARKET_FC_URL='https://<新函数域名>/search'
```

新增 TypeORM 实体为 `YahooFleamarketHunter` 和 `YahooFleamarketGoodsRecord`。本项目当前配置 `synchronize: true`，启动时会按实体建立新表；使用关闭同步的部署环境时，需要先按实体创建对应表与外键。

重启 goods hunter 后，调用现有登录态保护的任务接口：

```json
{
  "type": "YahooFleamarket",
  "schedule": "*/10 * * * *",
  "searchCondition": {
    "keyword": "ちいかわ 缶バッジ",
    "epoch": 2,
    "minPrice": 300,
    "maxPrice": 3000,
    "excludeKeywords": ["まとめ売り"],
    "notifyExisting": false
  }
}
```

请求为 `POST /goods/registerGoodsWatcher`，也支持原有 `freezeStart/freezeEnd` 字段。任务列表、更新、删除继续使用现有 `/goods/listGoodsWatcher`、`/goods/updateGoodsWatcher`、`/goods/unregisterGoodsWatcher`；更新和删除均检查任务归属。平台类型必须传 `YahooFleamarket`。

价格为非负日元整数；`epoch` 默认 1，最大 3。价格范围和排除词在已获取商品中本地过滤；排除词作用于标题。只提醒 `OPEN` 商品，未知销售状态不会被当成可售。

默认首次成功执行只建立基线；设置 `notifyExisting: true` 时首轮也通知。后续按任务＋商品 ID 持久去重，重启保留。更改搜索条件会重新建立基线；只改执行时间不会清空已见记录。新货提醒不以 `openTime` 或一个已见 ID 提前终止扫描；热门词超出扫描窗口仍可能漏报。

邮件发送前先保存待发送记录，失败后在下一次成功扫描时重试；SMTP 成功但确认写库失败仍可能重发，不承诺严格一次投递。同任务有进程内执行互斥；当前延续项目单实例调度方式，多实例部署需增加分布式任务锁。

## 3. 验证

FC 单元和 HTTP 契约测试（不访问真实网站）：

```bash
cd ../bypass-cloudflare
python3 -m unittest discover -s tests -v
```

goods hunter 单元与路由测试：

```bash
npm run test:yahoo-fleamarket
npm run build
```

使用临时 Docker MySQL 的集成测试（自动清理测试容器和测试数据库）：

```bash
npm run test:yahoo-fleamarket:integration
```

此测试不启动现有应用或生产 Cron，不连接原有数据库，不发送真实邮件。可用 `MYSQL_TEST_IMAGE` 指定本地测试 MySQL 镜像。

开发验证已使用专用 FC 容器运行 Chrome，并通过 goods hunter 的真实签名 HTTP 客户端请求 `ちいかわ 缶バッジ`，得到 100 件 `OPEN` 商品；这是本地容器验证，云端 FC 部署与出口仍需上线后复核。

新 FC 部署后的签名冒烟测试（只请求一页，不写库、不发邮件）：

```bash
node -r ts-node/register scripts/smoke-yahoo-fleamarket.js 'ちいかわ 缶バッジ'
```

站点结构、排序语义和访问规则背景见 [调研报告](yahoo-fleamarket-research.md)。FC HTTP 签名依据 [阿里云官方说明](https://help.aliyun.com/zh/functioncompute/configure-signature-authentication-for-http-triggers)，容器端口与入口依据 [FC3 自定义容器文档](https://help.aliyun.com/zh/functioncompute/create-a-custom-container-function-in-a-container-runtime)。
