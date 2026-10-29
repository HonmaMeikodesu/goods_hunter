# Yahoo 拍卖会话维护部署记录

日期：2026-10-29。服务器：`117.72.87.16`；应用目录：`/home/wangming/project/goods_hunter`；运行用户：`wangming`。

## 部署状态

已完成 X11 人工登录、服务器 headless 刷新、阿里云 FC 登录验证，主应用已启用托管 Cookie。`yahoo-session.timer` 已启用，每 24 小时启动浏览器刷新一次，附加最多两分钟抖动；浏览器执行完退出。应用每次采集动态读取快照，无需随 Cookie 更新重启。

首次部署验收：北京时间 23:42:33 刷新成功，状态 `ready`，正式服务 `Result=success / ExecMainStatus=0`，随后 FC 验证再次返回 `true`。23:43 检查无常驻 Chrome，HTTP 健康检查 200；该次验收采用小时周期，现已改为每日周期。

- Google Chrome 156.0.8078.73；独立 Python 3.12.13 位于 `~/.local/share/goods-hunter/runtime/python`，未替换系统 Python 3.8。
- `tools/yahoo-session/.venv` 使用 Playwright 1.58.0，Chrome sandbox 保持启用。
- 状态目录 `/home/wangming/.local/share/goods-hunter/yahoo-session` 为 0700，`session.json` 和 `browser-state.json` 为 0600。快照包含 8 个适用于拍卖域名的 Cookie，不公开其内容。
- 服务器直连 Yahoo 超时；复用现有 FC 代理配置，部署独立 `yahoo-session-proxy.service`。入口仅为 `127.0.0.1:17890`，DNS 仅为 `127.0.0.1:17853`，未开放公网管理接口。
- `wangming` 已启用 linger。刷新 service 配置 MemoryMax=512M、TimeoutStartSec=150；代理服务配置 MemoryMax=192M。配置值不等同于已验证所有宿主机 cgroup 内存限制生效。
- 主应用启动环境已设置 `YAHOO_SESSION_FILE` 指向上述快照；重启后的 HTTP 健康检查为 200。旧 Cookie 文件保留用于回滚。

## 真实验收与修正

1. 用户在 X11 Chrome 完成登录。当前 `/my` 没有预设的退出链接，原检测因此持续等待。改为兼容个人页可见的“入札中”链接，并保留旧版退出链接；同时严格核验个人页域名和路径。
2. 匿名浏览器访问 `/my` 跳至 `login.yahoo.co.jp/ncaptcha`，登录标识数量为 0；已登录 profile 在 headless 模式访问个人页返回 200，通过标识检查并保存有效快照。
3. 阿里云 FC 使用自动生成的快照访问个人页，返回 `result: true`。部署后的真实代码使用当前任务中的 `26084` 分类成功解析 50 条结果；该检查不写入任务记录、不发送通知。成人专属分类及单个成人拍品尚未单独验收，不将普通分类结果等同于成人访问验证。
4. 正式服务曾反复出现 `net::ERR_CONNECTION_CLOSED`。代理未重启，curl 对照连续返回正常 302。Chrome 仅关闭 HTTP/2 后，同一正式服务环境连续三次刷新成功；已在环境文件设置 `YAHOO_BROWSER_DISABLE_HTTP2=1`，X11 启动脚本也采用相同配置。底层断连发生在代理还是上游端未进一步归因。
5. 导航连接错误最多尝试三次（每次最多 30 秒，间隔 2/4 秒）；耗尽报 `NETWORK_ERROR`，保留上次有效快照和原验证时间。真正跳到登录页仍要求人工登录，不因重试绕过校验。
6. 新增相对/绝对“入札中”链接与登录重定向回归检查：17 项会话 Jest 测试及 TypeScript 检查通过；5 项 Python 测试覆盖真实 Chrome + Xvfb 的 headed → headless、Cookie 轮换、断连恢复和重试耗尽、登录失效。

首次窗口于北京时间 20:50:03 启动，21:50:15 因原设定的一小时登录等待超时而退出。远程启动脚本已改为四小时，可用 `YAHOO_LOGIN_TIMEOUT_SECONDS` 覆盖。之后 X11 连接断开时，已登录 profile 成功保留，本次无需再次人工登录。

尚未实测 Yahoo 会话的长期存活时间与实际 Cookie 轮换周期；按用户要求，刷新周期已改为每天一次，主应用快照有效期调整为 48 小时（`YAHOO_SESSION_MAX_AGE_SECONDS=172800`），避免每天刷新与默认六小时有效期冲突。noVNC 未实测。

## 运维与回滚

管理员私有部署目录：

```text
/home/wangming/project/.goods_hunter-deployments/yahoo-session-20261029-01/
```

`activation-before.tar.gz` 保存切换前文件，`runtime-before.json` 保存旧进程启动信息（含敏感环境，勿公开），`activated.json` 记录应用切换完成。`check-candidate.cjs` 可执行 FC 只读验证，`search-check.cjs` 可执行分类只读验证。`prepared.json` 为安装时的历史记录，最终激活以 `activated.json` 为准。

用 wangming 用户检查：

```bash
systemctl --user list-timers yahoo-session.timer
systemctl --user status yahoo-session.service
cd /home/wangming/project/goods_hunter
tools/yahoo-session/.venv/bin/python tools/yahoo-session/session_manager.py status \
  --state-dir /home/wangming/.local/share/goods-hunter/yahoo-session
```

oneshot 刷新成功后显示 `inactive (dead)` 属于正常状态；应结合 `Result=success` 和快照验证时间判断。真正需要重新登录时，在本地仓库根目录执行：

```bash
./tools/yahoo-session/login-x11.sh
# 只检查 SSH、X11 和服务器运行环境：
./tools/yahoo-session/login-x11.sh --check
```

2026-10-30 已将远程辅助脚本 `tools/yahoo-session/login-x11-remote.sh` 部署到服务器；入口不再依赖私有部署目录中的启动脚本。默认复用当前服务器、SSH 密钥和已有会话环境文件，`--help` 可查看覆盖方式。不要并发打开同一 profile；登录成功后自动保存并关闭窗口，Xauthority 临时文件也会清理。

脚本验收：`--check` 通过；实际运行时在本地 X server 观察到服务器 profile 的 Chrome 窗口，随后北京时间 2026-10-30 00:08:49 保存 `ready` 快照并退出，脚本返回 0。缺少本地 `DISPLAY` 时会在连接服务器前明确报错；Bash 语法检查通过。

回退时停止 `yahoo-session.timer`，移除主应用启动环境中的 `YAHOO_SESSION_FILE` 后重启，恢复旧 Cookie 文件方式；如需回退代码，使用上述文件备份并恢复旧进程启动配置。任何 profile、快照或私有运行环境都不得提交或公开。
