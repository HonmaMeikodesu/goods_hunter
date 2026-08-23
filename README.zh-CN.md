# Goods Hunter（Go 实验版）

这是 `experiment/go-rewrite` 分支上的 Go 重构版本。它保留了原项目的注册/登录、五类 watcher、定时抓取、冻结时段、去重邮件、单品价格与售罄监控、代理配置加密下发等行为，同时把 Node/Midway、TypeORM、MySQL 和 Redis 的运行时依赖收进一个 Go 进程。

## 技术与运行要求

- Go 1.25 或更高版本
- 唯一的第三方 Go 依赖是 `golang.org/x/net/html`
- 默认监听 `:7001`
- 默认状态文件为 `var/goods-hunter.json`，权限为 `0600`
- 状态存储面向单进程部署；不要让多个实例同时写同一个文件

状态写入采用同目录临时文件、`fsync` 和原子替换。若写入因磁盘满等原因失败，内存变更也会回滚，不会让进程状态与磁盘状态分叉。商品去重记录只保存商品 ID 与首次发现时间，避免重复存储标题、价格等大字段。

## 快速开始

项目内置的 Make 目标把 Go 构建缓存和模块缓存放到 `/tmp`，不会写入仓库：

```bash
make test
make build
GH_MAIL_MODE=log /tmp/goods-hunter
```

浏览器打开 `http://localhost:7001/`。`log` 邮件模式会把注册确认链接和通知写入日志，适合本地实验。

验证结束后可释放临时缓存：

```bash
make clean-cache
```

## 配置

Go 版兼容原先被 `.gitignore` 忽略的 `src/private/` 文件：

| 文件 | 用途 | 是否必需 |
| --- | --- | --- |
| `server.json` | 外部访问地址 `serverHost` | 否，默认 `localhost:7001` |
| `email.json` | SMTP 与系统管理员邮箱 | SMTP 模式必需 |
| `alicloud.json` | AliCloud 浏览器渲染函数 | 执行抓取时必需 |
| `yahoo.json` | Yahoo Cookie 原文 | Yahoo 登录态检查/抓取可选 |
| `secret.json` | AES JWK | `/api/config/proxy` 必需 |
| `config.yaml` | 加密下发的代理配置 | `/api/config/proxy` 必需 |

常用环境变量：

| 变量 | 默认值/说明 |
| --- | --- |
| `GH_LISTEN_ADDRESS` | `:7001` |
| `GH_SERVER_HOST` | 对外访问的主机名或完整 URL |
| `GH_DATA_FILE` | `var/goods-hunter.json` |
| `GH_PRIVATE_DIR` | `src/private` |
| `GH_MAIL_MODE` | 有完整 SMTP 配置时为 `smtp`，否则为 `log` |
| `GH_SMTP_HOST`, `GH_SMTP_PORT` | SMTP 地址；端口默认 `465` |
| `GH_SMTP_USER`, `GH_SMTP_PASSWORD` | SMTP 凭据 |
| `GH_SMTP_TLS_MODE` | `implicit`、`starttls` 或 `plain` |
| `GH_SYSTEM_OWNER` | 审批注册申请、发送邮件使用的地址 |
| `GH_ALICLOUD_ACCESS_KEY_ID` | AliCloud AccessKey ID |
| `GH_ALICLOUD_ACCESS_KEY_SECRET` | AliCloud AccessKey Secret |
| `GH_ALICLOUD_URL` | 浏览器渲染函数 URL |
| `GH_YAHOO_COOKIE` | Yahoo Cookie 原文 |
| `GH_SECURE_COOKIE` | HTTPS 部署时设为 `true` |
| `GH_SESSION_TTL` | 登录态有效期，默认 `168h` |
| `GH_REGISTRATION_TTL` | 注册确认码有效期，默认 `12h` |

敏感配置不会写入日志。生产环境应使用环境变量或权限受控的 `src/private/` 文件，并启用 `GH_SECURE_COOKIE=true`。

## 兼容路由

成功 JSON 响应保持 `{ "code": "200", "data": ... }` 形式，业务错误继续使用原六位错误码。

- `GET /`
- `POST /login`
- `POST /register`
- `GET /register/confirm?code=...`
- `GET /api/config/proxy`
- `POST /goods/registerGoodsWatcher`
- `GET /goods/registerSurveillanceWatcher?type=...&goodId=...`
- `GET /goods/unregisterGoodsWatcher?id=...&type=...`
- `GET /goods/listGoodsWatcher`
- `POST /goods/updateGoodsWatcher`

登录与注册同时接受 JSON 和 `application/x-www-form-urlencoded`；watcher 的新增与更新也兼容这两种格式。

## 数据迁移说明

实验版不直接连接原 TypeORM 使用的 MySQL/Redis，也不会自动读取其中的数据。首次运行会创建新的 JSON 状态文件；切换前请保留原数据库备份。新状态文件可以直接备份和恢复，但不要在进程运行时手工编辑。

模块设计、故障语义和旧代码映射见 [Go 架构说明](doc/go-architecture.md)。
