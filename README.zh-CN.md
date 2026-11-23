# 谷子猎手

谷子猎手订阅 Mercari、Yahoo!オークション、骏河屋、Mandarake、Yahoo!フリマ和闲鱼的商品搜索，定时去重并发送邮件。Mercari、Yahoo!オークション、骏河屋和 Mandarake 还支持单品监控。

[Android App](mobile/README.md) 支持主动搜索和按站点重试。开启主动模式后，定时采集到的新品也会累积在 App 中，供你一次查看。

## 构建与运行

构建需要 Go 1.25 或以上版本。使用现有的 MySQL、Redis、SMTP 和阿里云 FC。Go 版沿用 Midway 的 MySQL 表和 Redis 键，可直接读取现有账号、登录态、任务、扫描记录和待发邮件。

```bash
mkdir -p bin
go build -trimpath -o bin/goods-hunter ./cmd/goods-hunter
export GOODS_HUNTER_MYSQL_DSN='<user>:<password>@tcp(127.0.0.1:3306)/goods_hunter'
export GOODS_HUNTER_REDIS_URL='redis://127.0.0.1:6379/0'
bin/goods-hunter -check
bin/goods-hunter
```

默认监听 `:7001`。生产环境请保留 Redis 的认证设置和库号，例如 `redis://:<URL 编码后的密码>@127.0.0.1:6379/0`。新环境先创建字符集为 `utf8mb4` 的 MySQL 数据库，然后运行 `bin/goods-hunter -init-db` 建表。

升级到支持主动模式的版本时，先用新版二进制运行一次 `-init-db` 创建两张新表，再运行 `-check` 并切换版本。原有的账号、任务和商品记录可直接沿用。

## 配置

Go 版默认从 `src/private/` 读取既有配置，可用 `GOODS_HUNTER_CONFIG_DIR` 指定其他绝对路径。

| 文件 | 字段或用途 |
| --- | --- |
| `server.json` | `serverHost` 用于邮件链接。可用 `GOODS_HUNTER_PUBLIC_URL` 覆盖，支持完整的 HTTPS 地址 |
| `email.json` | `host`、`user`、`password`、`systemOwner`、`contactSystemOwner`。沿用隐式 TLS SMTP，默认 465 端口 |
| `alicloud.json` | `accessKeyId`、`accessKeySecret`、`url`、`yahooFleamarketUrl`、`xianyuUrl`。专用入口也可用 `YAHOO_FLEAMARKET_FC_URL` 和 `XIANYU_FC_URL` 设置 |
| `secret.json`、`config.yaml` | 代理配置及 AES-GCM JWK。配套 FC 继续从 `/api/config/proxy` 获取加密配置 |
| `yahoo.json` | 旧 Yahoo Cookie 文件。托管会话使用 `YAHOO_SESSION_FILE`，详见 [Yahoo 会话维护](doc/yahoo-session-setup.md) |

`GOODS_HUNTER_ADDR` 可覆盖监听地址。HTTPS 部署请将公开地址设为 HTTPS，以便登录 Cookie 带上 `Secure`。需要兼容 Egg 签发和校验的 `loginState.sig` 时，设置 `GOODS_HUNTER_COOKIE_KEY` 为原应用的 Cookie 签名密钥。

## 从 Midway 切换

1. 使用数据库备份或副本运行 `bin/goods-hunter -check`，检查既有 MySQL 表、Redis 和任务配置。
2. 停止旧应用，再让单个 Go 进程连接原有 MySQL 和 Redis。应用按北京时间调度，每天 22:00 汇总当天从 00:00 起的搜索扫描。
3. 使用原账号登录，检查既有任务列表，再验证一轮采集和通知。Yahoo 托管会话继续由 [现有会话工具](doc/yahoo-session-setup.md) 刷新。

回滚时先停止 Go 进程，再启动旧版本并连接同一数据库和 Redis。Go 版生成的待确认注册只保存密码摘要，回滚后这部分未完成注册需重新提交。发布 Go 程序仅需二进制文件和私有配置目录，部署前设置相应的绝对路径与进程环境。

## 验证与入口

```bash
go test ./...
./scripts/test-integration.sh
GOODS_HUNTER_TEST_COLLECTOR=../bypass-cloudflare ./scripts/test-integration.sh
```

集成脚本使用本机已有的 MySQL、Redis 和可选 FC 镜像。它在临时库中测试账号、任务、SMTP 重试前后的持久化状态和日报。可选的 FC 测试使用配套仓库的真实 HTTP 处理器和本地页面夹具。

- [Yahoo!フリマ接入及任务示例](doc/yahoo-fleamarket-setup.md)
- [闲鱼接入及任务示例](doc/xianyu-setup.md)
- [Yahoo 拍卖登录与会话维护](doc/yahoo-session-setup.md)
