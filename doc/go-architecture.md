# Go 重构架构说明

## 目标

Go 版以单进程、低依赖、低磁盘占用为约束，完整承接原项目的账户、watcher、抓取、通知和代理配置能力。运行时不再需要 Node/Midway、Redis、TypeORM 或 MySQL。

## 模块与 seam

| 旧实现 | Go 模块 | 对外 interface / 职责 |
| --- | --- | --- |
| controller + middleware | `internal/web` | HTTP 校验、登录 Cookie、兼容响应与错误码 |
| login/register service | `internal/accounts` | `Register`、`Confirm`、`Login`、`Authenticate` |
| hunterRouteService + hunterArsenal | `internal/hunter` | watcher 生命周期、调度、冻结、去重和通知 |
| TypeORM + Redis | `internal/state` | 并发安全、copy-on-write、原子文件提交 |
| site API + AliCloud API | `internal/market` | `Search`、`Snapshot`；AliCloud 是生产 adapter |
| nodemailer | `internal/notify` | SMTP 与日志两个 adapter |
| cipher service | `internal/cipher` | 兼容原 AES-GCM payload interface |
| cron package | `internal/schedule` | 五字段 cron 与每个 watcher 的防重入执行 |

真正会变化的外部 seam 只有两处：

1. `hunter.Marketplace`：生产使用 AliCloud 浏览器渲染 adapter，测试使用内存 fake。
2. `accounts.Sender` / `hunter.Sender`：生产使用 SMTP adapter，本地与测试分别使用日志和内存 fake。

状态文件是本地可替代依赖，测试直接在临时目录运行同一个实现，因此没有再制造一层仅转发调用的 repository interface。

## 状态提交语义

每次变更遵循以下顺序：

1. 在锁内复制当前状态。
2. 只修改副本。
3. 将紧凑 JSON 写入同目录临时文件并执行 `fsync`。
4. 原子替换正式文件。
5. 仅在替换成功后让新内存状态生效。

写盘失败时副本被丢弃，调用方收到错误。文件权限固定为 `0600`，其中包含密码摘要和登录态，不应放到共享目录。该实现只保证单进程一致性，不提供跨进程锁。

## 调度与通知不变量

- cron 使用五字段格式，时区固定为 Asia/Shanghai（UTC+8）。
- 同一 watcher 上一次执行未结束时不会重叠执行。
- 搜索通知发送成功后才记录商品 ID；发送失败不会吞掉更新。
- 更换搜索条件时清空该 watcher 的旧去重集合。
- 单品价格变化或首次获得有效快照时通知；售罄通知成功后自动删除 watcher。
- 状态文件写入失败可能导致下一次重复通知，但不会导致更新永久丢失。

## 安全改进

- 新密码使用带随机盐的 PBKDF2-HMAC-SHA256；仍可识别旧 SHA-256 摘要并在成功登录后升级。
- 登录 Cookie 设置 `HttpOnly` 和 `SameSite=Lax`，HTTPS 部署可启用 `Secure`。
- 请求体限制为 1 MiB，代理配置限制为 2 MiB，AliCloud HTML 响应限制为 32 MiB。
- watcher 更新与删除均检查所有权；原实现的更新路径没有完整所有权校验。
- 日志不输出 SMTP 密码、Cookie、AES key 或 AliCloud secret。

## 测试面

测试从模块 interface 观察行为，不依赖 MySQL、Redis、SMTP 或真实网络：

- 四个平台的仓库内 HTML fixture 解析；
- AliCloud ACS3 签名固定向量；
- AES-GCM 完整性与往返；
- cron 校验与匹配；
- 注册、确认、登录、状态文件重开；
- watcher 去重、条件更新、权限、价格变化和售罄退订；
- 原 HTTP 路由的端到端流程；
- 磁盘写入失败时的内存回滚。
