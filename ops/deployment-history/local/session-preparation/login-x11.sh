#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ -n "${DISPLAY:-}" ]] || { echo 'SSH X11 forwarding is required.' >&2; exit 1; }
auth_file="$(mktemp /tmp/goods-hunter-x11.XXXXXX)"
trap 'rm -f "$auth_file"' EXIT
xauth extract "$auth_file" "$DISPLAY"
chown wangming:wangming "$auth_file"
runuser -u wangming -- env DISPLAY="$DISPLAY" XAUTHORITY="$auth_file" xdpyinfo >/dev/null
echo 'X11 forwarding verified for wangming.'
app=/home/wangming/project/goods_hunter
if [[ "${1:-}" == test ]]; then
  cd "$app"
  runuser -u wangming -- env DISPLAY="$DISPLAY" XAUTHORITY="$auth_file" YAHOO_TEST_BROWSER=1 "$app/tools/yahoo-session/.venv/bin/python" -m unittest discover -s tools/yahoo-session -p 'test_*.py' -v
else
  systemd-run --scope --unit=goods-hunter-yahoo-login -p MemoryMax=512M runuser -u wangming -- env DISPLAY="$DISPLAY" XAUTHORITY="$auth_file" YAHOO_BROWSER_PROXY=http://127.0.0.1:17890 YAHOO_SESSION_DIR=/home/wangming/.local/share/goods-hunter/yahoo-session "$app/tools/yahoo-session/.venv/bin/python" "$app/tools/yahoo-session/session_manager.py" login --login-timeout "${YAHOO_LOGIN_TIMEOUT_SECONDS:-14400}"
fi
