# Yahoo 拍卖登录会话维护

实现位置：`tools/yahoo-session/session_manager.py`。首次用有界面的 Chrome 手工登录，以后定时启动同一个 profile 的 headless Chrome，访问 `https://auctions.yahoo.co.jp/my`，验证登录后原子更新 Cookie 快照，再退出浏览器。采集仍由阿里云 FC 执行，goods hunter 每轮读取最新快照并传给 FC。

## 状态与失效处理

- 独立目录内的 `profile/` 保存 Chrome 登录状态；`browser-state.json` 保存完整浏览器存储备份，恢复 Chrome 退出时可能丢失的 Cookie。两个模式使用同一个 Chrome channel/profile，由文件锁禁止并发打开。
- `session.json` 只发布适用于 Yahoo 拍卖域名的 Cookie，保留原来的 domain、path、expires、httpOnly、secure、sameSite 等属性。目录权限 0700，快照 0600；不输出 Cookie 值。
- 只有 `/my` 或兼容的个人页地址，以及明确的已登录元素同时出现，才发布 `ready` 快照。URL、HTTP 200、有 Cookie 均不能单独证明登录成功。
- 明确跳到登录页时标记 `needs_login`；保留旧数据供诊断，但 goods hunter 停用它，等待手动重新登录。
- 临时网络错误或页面无法验证时标记 `error`，不推进 `validatedAt`，允许使用尚未过期的上次成功快照；默认最长 6 小时。超过期限就停止采集。
- 导航遇到连接关闭、重置、连接超时或代理连接失败时，最多尝试 3 次，每次最多 30 秒，间隔 2/4 秒；耗尽后报 `NETWORK_ERROR`。登录失效和标识不符不会因此被当作成功。
- 配置托管会话后，文件缺失、过期或需要登录会阻止该轮所有 Yahoo 拍卖任务（包括普通分类），不会写入已发现商品记录；不会悄悄回退到旧 Cookie。Mercari、Yahoo Flea Market 不受影响。
- 主应用每小时通过现有 FC 检查个人页；失败邮件只含已知原因码，Redis 原子限流使所有进程合计最多每 24 小时提醒一次，重启或短暂恢复均不清除冷却期。网络/页面验证错误使用 `Yahoo session check unavailable`，只有明确登录要求才使用 `Yahoo session needs login`，不能根据检查失败推断 Cookie 已过期。Redis 不可用时只记错误日志、不发送无限流邮件；SMTP 结果不确定时保留冷却期以避免重复投递。FC 检查用于发现服务器出口差异，不向会话文件反向写入 Cookie，避免并发覆盖。

## 准备

在运行 goods hunter 的普通 Linux 用户下操作，项目路径示例为 `$HOME/project/goods_hunter`：

```bash
cd "$HOME/project/goods_hunter"
python3 -m venv tools/yahoo-session/.venv
tools/yahoo-session/.venv/bin/pip install -r tools/yahoo-session/requirements.txt
export YAHOO_SESSION_DIR="$HOME/.local/share/goods-hunter/yahoo-session"
export YAHOO_SESSION_FILE="$YAHOO_SESSION_DIR/session.json"
export YAHOO_SESSION_MAX_AGE_SECONDS=172800
```

需要 Python 3.9+、对应的 `python3-venv` 和完整 Google Chrome（默认 `channel=chrome`）。请用普通用户启动，默认启用 Chrome sandbox。也可选 `YAHOO_BROWSER_CHANNEL=chromium` 并用虚拟环境里的 `playwright install chromium` 安装完整 Chromium；两个模式必须选同一 channel。`--no-sandbox` 仅供已有外层隔离且无法启用 sandbox 的容器，不是普通服务器的默认选项。

默认验证个人页中的“入札中”链接（`/my/bidding` 或同域绝对 URL），并兼容旧版 Yahoo 登录域名的 `logout` 链接；还必须停留在精确匹配的 Yahoo 个人页 URL。2026-10-29 已用真实账号验证：当前个人页没有退出链接，但有可见的“入札中”入口；匿名浏览器访问 `/my` 会跳到登录域名，且不含该标识。若站点改版，应通过 `YAHOO_AUTH_SELECTOR` 同时更新会话进程和主应用。不要设为 `body`、通用页面容器或匿名页面也存在的元素。找不到可靠元素会报 `AUTH_UNVERIFIED`，不会发布新 Cookie。

需要代理时设置 `YAHOO_BROWSER_PROXY=http://host:port` 或 `socks5://host:port`；认证单独放 `YAHOO_PROXY_USERNAME` / `YAHOO_PROXY_PASSWORD` 环境变量。不要把密码写入命令行。尽量保持服务器浏览器与 FC 出口地区一致，但仍须验证 Yahoo 是否接受在 FC 中使用该会话。

若代理下 Chrome 持续报连接关闭，可设置 `YAHOO_BROWSER_DISABLE_HTTP2=1`（或 `--disable-http2`）使用 HTTP/1.1。当前服务器已开启此兼容选项：默认协议反复出现 `ERR_CONNECTION_CLOSED`，仅关闭 HTTP/2 后连续三次真实刷新成功；无需关闭 Chrome sandbox 或 TLS 校验。

## 首次登录：X11 或 noVNC 二选一

### X11

本地需要可用的 X server，服务器 SSH 需要允许 X11 转发。当前服务器已经部署完毕，在本地仓库根目录执行：

```bash
./tools/yahoo-session/login-x11.sh
# 只检查连接与转发，不启动 Chrome、不修改 Cookie：
./tools/yahoo-session/login-x11.sh --check
```

脚本默认连接 `root@117.72.87.16`，优先使用本机 `$HOME/.ssh/jingdong.pem`（不存在时使用 SSH 配置或 agent），以服务器上的 `wangming` 用户启动 Chrome。它读取该用户已有的 `~/.config/goods-hunter/yahoo-session.env`，复用日常刷新的 profile、代理和 HTTP/1.1 配置。该环境文件使用兼容 Bash 的 `KEY=value` 写法；由应用用户读取，不以 root 身份执行。

在弹出的浏览器中自行完成密码、短信或其他验证，最终回到个人页。验证成功后自动保存并关闭；如果登录态仍有效，窗口可能只显示几秒。保持终端连接，勿提前关闭。默认等待四小时，真正掉登录时才需要重新执行；每天的 headless 刷新会自动复用新会话。刷新期间执行登录会返回 `PROFILE_BUSY`，稍后再试即可。

`--help` 列出可覆盖的配置，例如：

```bash
YAHOO_SSH_KEY="$HOME/.ssh/another-key.pem" ./tools/yahoo-session/login-x11.sh
YAHOO_SSH_HOST=wangming@your-server YAHOO_REMOTE_APP=/absolute/server/repo \
  ./tools/yahoo-session/login-x11.sh
```

还可设置 `YAHOO_REMOTE_USER`、`YAHOO_LOGIN_TIMEOUT_SECONDS`（1–86400 秒）。服务器仓库必须存在 `login-x11-remote.sh` 和已安装的会话工具；本次已同步部署。远程辅助脚本临时转交 Xauthority，结束时删除授权文件，Chrome 始终由非 root 用户运行。没有本地 `DISPLAY` 时，应从有图形会话的终端执行，或使用下面的 noVNC 方式。

### noVNC（无需本地 X server）

服务器需安装 `xvfb`、`xauth`、`x11vnc`、`novnc`、`websockify`（Debian/Ubuntu 包名）。启动：

```bash
cd "$HOME/project/goods_hunter"
export YAHOO_SESSION_DIR="$HOME/.local/share/goods-hunter/yahoo-session"
bash tools/yahoo-session/login-novnc.sh
```

本地另开终端：

```bash
ssh -N -L 6080:127.0.0.1:6080 user@server
```

本地浏览器打开 `http://127.0.0.1:6080/vnc.html`，连接后手工登录。VNC/WebSocket 只监听服务器 loopback，端口分别 5901/6080，登录结束关闭。该脚本依赖 SSH 隧道认证，没有另外设置 VNC 密码，适合可信本机用户环境；不要反向代理或公开这些端口。`YAHOO_NOVNC_WEB` 可覆盖 noVNC 静态文件目录，`YAHOO_SESSION_PYTHON` 可覆盖 Python 路径。

## 验证后接入应用

先运行一次 headless 刷新，然后检查 FC：

```bash
export YAHOO_SESSION_FILE="$YAHOO_SESSION_DIR/session.json"
export YAHOO_SESSION_MAX_AGE_SECONDS=172800
tools/yahoo-session/.venv/bin/python tools/yahoo-session/session_manager.py refresh
tools/yahoo-session/.venv/bin/python tools/yahoo-session/session_manager.py status
node tools/yahoo-session/check-fc.cjs
```

`check-fc.cjs` 使用现有 `src/private/alicloud.json` 访问个人页，只输出结果和原因码；需要项目 Node 依赖。`ready` 仅表示服务器浏览器通过检查；FC 检查成功后，还需用一个原本就有访问权限的成人分类任务验证实际采集。这些真实账号验收步骤不能由离线测试替代。

将绝对路径的 `YAHOO_SESSION_FILE` 放入 **goods hunter 自身的启动环境** 并重新启动应用一次；此后 Cookie 更新无需重启。可设置 `YAHOO_SESSION_MAX_AGE_SECONDS`（默认 21600），自定义选择器时同时设置 `YAHOO_AUTH_SELECTOR`。每天刷新时，将 `YAHOO_SESSION_MAX_AGE_SECONDS=172800` 一并放入主应用启动环境。只在 shell 中 export 不会更新已经运行的应用进程。

## 每天自动刷新

提供 systemd **用户级** service/timer 模板。默认项目路径 `%h/project/goods_hunter`，路径不同时修改 unit。先完成上面的登录和手工验证，再启用：

```bash
mkdir -p "$HOME/.config/systemd/user" "$HOME/.config/goods-hunter"
install -m 600 /dev/null "$HOME/.config/goods-hunter/yahoo-session.env"
```

编辑环境文件，填入实际绝对路径（EnvironmentFile 不展开 `$HOME`）：

```ini
YAHOO_SESSION_DIR=/home/YOUR_USER/.local/share/goods-hunter/yahoo-session
# 按需添加 YAHOO_AUTH_SELECTOR、YAHOO_BROWSER_PROXY 等
```

这个文件只供会话维护 unit 使用；主应用环境仍需独立配置。

```bash
cp tools/yahoo-session/yahoo-session.service tools/yahoo-session/yahoo-session.timer "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now yahoo-session.timer
systemctl --user list-timers yahoo-session.timer
journalctl --user -u yahoo-session.service -n 20
```

默认启动后约 5 分钟首次执行，随后每 24 小时执行一次，附加最多 2 分钟抖动。不是常驻 Chrome，执行完即退出。已知需要登录时会直接返回，不反复启动浏览器。若用户退出 SSH 后也要保持 user manager，需要管理员为该用户启用 `loginctl enable-linger USER`。每天刷新时，主应用应配置 `YAHOO_SESSION_MAX_AGE_SECONDS=172800`（48 小时），为刷新延迟或一次临时失败留出余量；未配置时仍默认 6 小时。刷新频率和有效期均可调整，尚未实测 Yahoo 的轮换周期。

## 排查与回退

`status` 不启动浏览器，不输出 Cookie；返回状态、成功/尝试时间、错误码和 Cookie 数量。`NEEDS_LOGIN` 重新执行 `login`；`DISPLAY_REQUIRED` 检查 X11 或使用 noVNC；`AUTH_UNVERIFIED` 检查真实登录状态和选择器；`NETWORK_ERROR` 检查代理及上游连接；`BROWSER_ERROR` 检查 Chrome、sandbox、依赖、代理。浏览器原始异常可能含凭据，因此不会直接写日志。

回退时停止 `yahoo-session.timer`，删除主应用环境中的 `YAHOO_SESSION_FILE` 后重启，即恢复旧 `src/private/yahoo.json` Cookie 方式（也可用 `YAHOO_COOKIE_FILE` 指定路径）。旧文件现在也按扫描动态读取。Profile 和 JSON 都是登录凭据，不要提交、分享或附到日志中。

## 本地验证

```bash
npx jest --runInBand test/yahooSession test/api/searchParsing.test.ts test/yahooFleamarket
python3 -m unittest discover -s tools/yahoo-session -p 'test_*.py' -v
YAHOO_TEST_BROWSER=1 xvfb-run -a tools/yahoo-session/.venv/bin/python -m unittest discover -s tools/yahoo-session -p 'test_*.py' -v
```

浏览器测试拦截全部页面请求，使用合成 Cookie 和页面，验证 headed → headless 的 profile 复用、Cookie 恢复/轮换、连接重试及登录重定向失败处理。它不访问真实 Yahoo 账号。真实环境验收另见部署记录；noVNC 隧道及成人专属分类尚未单独验收。

2026-10-29 验证结果：前期 39 项 Jest 测试通过、8 项真实环境测试跳过；适配新版个人页后，17 项会话 Jest 测试及 TypeScript 检查通过。5 项 Python 测试通过，包含完整 Chrome + Xvfb 的 headed → headless 测试（Playwright 1.58.0 / Python 3.12）。noVNC 脚本通过 Bash 语法检查，尚未实测远程隧道。服务器已完成 X11 人工登录、headless 刷新和 FC 验证，并切换生产配置、启用定时器，详情见 `yahoo-session-deployment-2026-10-29.md`。
