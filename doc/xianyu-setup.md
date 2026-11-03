# 闲鱼匿名采集接入与部署

`Xianyu` 使用独立的 `fetch-xianyu` 阿里云 FC，复用配套仓库的 Chrome、Xvfb 和 Playwright 运行环境。每次请求建立新的匿名浏览器上下文，直连闲鱼首页，经搜索框提交关键词，再选择“新发布 → 最新”。采集器只读取页面自身产生的搜索响应，不保存登录状态。

## 当前采集范围

固定采集最新排序的第一页，最多 30 条。接口校验实际请求的关键词、页码、排序以及业务返回码，只解析 `resultList`，不把“猜你喜欢”当成命中结果。`hasMore` 表示站点还有下一页，当前版本不继续翻页；热门词两次扫描之间新增超过一页时可能漏报。

价格为人民币：FC 和数据库使用整数 `priceFen`（分），任务的 `minPrice` / `maxPrice` 使用元，最多两位小数。没有经过验证的在售/售罄状态不会被推断或写成 `OPEN`。通知描述的是新发现商品，交易状态以商品页面为准。

关键词由任务明确指定，不自动替换。已验证“本间芽衣子”“初音未来”可返回相关商品；“面码”可能返回面膜等不相关内容。“未闻花名”返回空列表不代表整个匿名搜索不可用。需要更严格的匹配时使用标题包含词、排除词。

## FC 构建与部署配置

在配套 `bypass-cloudflare` 仓库中构建应用层：

```bash
docker build --pull=false --network=none -f Dockerfile.xianyu \
  --build-arg BASE_IMAGE=bypass-cloudflare:latest -t fetch-xianyu:local .
```

基础镜像应已经包含 Chrome/Xvfb、Python 和 Playwright。该 Dockerfile 会复制当前版本的浏览器启动器和可选代理入口，避免给旧入口仅设置变量却仍启动 Mihomo。默认 `PROXY_ENABLED=false`；部署配置也显式关闭代理，不需要代理配置下载凭据。

将构建后的镜像推送到自己的容器仓库，设置 `FC_ACCESS`、`FC_REGION`、`XIANYU_IMAGE` 后使用：

```bash
s deploy -t s.xianyu.yaml
```

模板使用函数认证、120 秒函数超时、2 GB 内存和实例并发 1。应用采集总超时为 95 秒。实例并发 1 只限制单个 FC 实例；goods_hunter 内部按进程串行执行闲鱼任务，多进程部署时仍需另外协调调度。

`POST /search`（也接受根路径）请求为：

```json
{"keyword":"本间芽衣子"}
```

仅接受 `keyword`，不接受 Cookie、任意目标 URL、排序或翻页参数。成功响应包含 `source: "xianyu"`、`page: 1`、`pageSize: 30`、`sort: "newest"`、`currency: "CNY"`、`resultState`、`hasMore` 和商品列表。商品字段为 `id`、`name`、`priceFen`、`thumbnailImageUrl`、`itemUrl`、`publishedAt`。

业务风控即使上游 HTTP 为 200 也会转为错误：`CHALLENGE_REQUIRED` / `LOGIN_REQUIRED` / `ACCESS_DENIED` 返回 403，`RATE_LIMITED` 返回 429，超时返回 504，结构不匹配等返回 502。正常且元数据一致的空列表返回 `resultState: "empty"`；它不解释无结果是无商品还是关键词被站点过滤。采集器不重放请求或处理验证码，失败留给后续定时扫描处理。

## goods_hunter 配置

设置环境变量 `XIANYU_FC_URL`，或在现有私有阿里云配置中增加 `xianyuUrl`，值为新函数的 HTTP 触发器 URL。复用已有 FC 签名凭据，原来的 `url` 和 `yahooFleamarketUrl` 保持各自用途。

新增实体 `XianyuHunter`、`XianyuGoodsRecord`。当前项目使用 TypeORM `synchronize: true`，应用启动时会创建对应表及外键；关闭同步的环境需先按实体创建表。商品记录以任务 ID 和商品 ID 组成联合主键。

通过现有任务注册接口 `POST /goods/registerGoodsWatcher` 创建任务，例如：

```json
{
  "type": "Xianyu",
  "schedule": "*/15 * * * *",
  "searchCondition": {
    "keyword": "本间芽衣子",
    "includeKeywords": ["手办"],
    "excludeKeywords": ["求购", "收购"],
    "minPrice": 10,
    "maxPrice": 500,
    "notifyExisting": false
  }
}
```

标题需包含所有 `includeKeywords`，且不含任何 `excludeKeywords`；比较不区分大小写。首次有效扫描只建立基线，后续按 ID 去重提醒；`notifyExisting: true` 会在首次扫描提醒已有结果。失败扫描不初始化或重置基线。邮件失败保留待通知记录，在后续成功扫描后重试。修改搜索条件会重新建立基线，只修改执行时间则保留去重历史。

列表、更新、删除仍走现有 `/goods/listGoodsWatcher`、`/goods/updateGoodsWatcher`、`/goods/unregisterGoodsWatcher`，平台类型传 `Xianyu`，更新和删除检查任务归属。当前版本没有单品状态监控。

## 本地验证

```bash
# 在 bypass-cloudflare 仓库
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v

# 在 goods_hunter 仓库
npm run test:xianyu
npm run test:xianyu:integration
npx tsc --noEmit
```

集成测试复用本地 `mysql:latest`，禁止自动拉取，在限容量内存盘创建临时数据库，测试结束删除容器；邮件为测试替身。`MYSQL_TEST_IMAGE` 可指定已有的兼容镜像。

2026-11-03 已完成云上部署、两个指定关键词的搜索验收与任务基线初始化，详见 [部署与任务注册记录](xianyu-deployment-2026-11-03.md)。本次验收不代表长期稳定性；间歇风控仍按失败处理，由后续定时扫描重试。

2026-11-03 后续更新：两个生产任务改为每小时扫描，00:00–08:30 暂停；修复 HTTP 图片地址丢失和邮件标题两行省略，详见 [调度与通知修复记录](xianyu-notification-fix-2026-11-03.md)。
