# 当前服务器配置

## 主应用发布

推送 `main` 触发 [GitHub Actions 流水线](../../.github/workflows/goods-hunter.yml)，运行 Go 测试并构建 Linux amd64 二进制文件。Pull Request 运行同一套测试和构建。

云服务器的 `goods-hunter-deploy.timer` 每约 90 秒检查公开仓库。只有当前 `main` 提交的推送流水线通过后，[deploy.py](deploy.py) 才会调用 [build.sh](build.sh)，用临时低权限身份拉取并构建该提交。Go 1.26.5 安装在 `/opt/goods-hunter/go`，构建缓存由 systemd 管理。

发布版本位于 `/opt/goods-hunter/releases/`，由 `/opt/goods-hunter/current` 指向当前版本。预检和 `goods-hunter.service` 都以 `wangming` 身份运行，共用 `/etc/goods-hunter/production.env` 中的生产配置。预检通过后切换版本并验证 7001 端口。启动验证失败时恢复上一个版本，可在 GitHub 重新运行对应提交的流水线以重试。

发布记录可以用 `journalctl -u goods-hunter-deploy.service` 查看。服务器安装时将 `deploy.py` 放到 `/usr/local/sbin/goods-hunter-deploy`，将 `build.sh` 放到 `/usr/local/libexec/goods-hunter-build`，并安装 [systemd 单元](systemd/)。

## App 的 HTTPS 入口

App 的 HTTPS 入口通过专用 Cloudflare Tunnel 转发 `/api/mobile/` 到本机 `127.0.0.1:7001`。隧道由 `goods-hunter-tunnel.service` 运行。部署域名放在 `/etc/goods-hunter-tunnel.yml`，专用运行凭据放在 `/etc/goods-hunter/tunnel.env`。

App 连接码和更新目录通过 `/etc/goods-hunter/production.env` 配置。`/opt/goods-hunter/mobile-updates` 由 root 管理，供 Go 服务只读分发安装包和签名热更新。发布步骤见 [Android App](../../mobile/README.md)。

## Yahoo 会话

`systemd/` 保存 `wangming` 用户启用的 Yahoo 会话单元，便于核对部署。刷新周期为每天一次，主应用通过 `YAHOO_SESSION_MAX_AGE_SECONDS=172800` 使用 48 小时快照有效期。

这些生产单元启用了本机私有代理；通用安装模板仍位于 `tools/yahoo-session/`，可以按其他环境选择不同代理。

服务器上的 `~/.config/goods-hunter/yahoo-session.env` 使用下面的非敏感设置（路径按部署用户调整）：

```ini
YAHOO_SESSION_DIR=/home/wangming/.local/share/goods-hunter/yahoo-session
YAHOO_BROWSER_CHANNEL=chrome
YAHOO_BROWSER_PROXY=http://127.0.0.1:17890
YAHOO_BROWSER_DISABLE_HTTP2=1
```

goods hunter 自身的进程环境还需设置 `YAHOO_SESSION_FILE` 与 `YAHOO_SESSION_MAX_AGE_SECONDS`；会话 service 的 EnvironmentFile 不会传递给主应用。代理节点、账号 Cookie、SSH 密钥与 FC 凭据必须单独保管，不提交 Git。
