# 当前服务器配置

`systemd/` 保存 117.72.87.16 上 wangming 用户实际启用的 Yahoo 会话单元，便于核对部署。刷新周期为每天一次，主应用通过 `YAHOO_SESSION_MAX_AGE_SECONDS=172800` 使用 48 小时快照有效期。

这些生产单元启用了本机私有代理；通用安装模板仍位于 `tools/yahoo-session/`，可以按其他环境选择不同代理。

服务器上的 `~/.config/goods-hunter/yahoo-session.env` 使用下面的非敏感设置（路径按部署用户调整）：

```ini
YAHOO_SESSION_DIR=/home/wangming/.local/share/goods-hunter/yahoo-session
YAHOO_BROWSER_CHANNEL=chrome
YAHOO_BROWSER_PROXY=http://127.0.0.1:17890
YAHOO_BROWSER_DISABLE_HTTP2=1
```

goods hunter 自身的进程环境还需设置 `YAHOO_SESSION_FILE` 与 `YAHOO_SESSION_MAX_AGE_SECONDS`；会话 service 的 EnvironmentFile 不会传递给主应用。代理节点、账号 Cookie、SSH 密钥与 FC 凭据必须单独保管，不提交 Git。
