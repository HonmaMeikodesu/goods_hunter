#!/usr/bin/env bash
# Run on the workstation with an X server, not inside the cloud SSH session.
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: ./tools/yahoo-session/login-x11.sh [--check | --help]

Open the cloud Yahoo browser on this workstation through SSH X11 forwarding.
Complete login in the browser; validated cookies are saved on the server and
the window closes automatically. Keep this terminal open until it finishes.
If already logged in, the browser may close after a few seconds.

--check  Verify SSH, X11 forwarding and the installed session tools without
         opening Chrome or changing cookies.

Environment overrides:
  YAHOO_SSH_HOST               Default: root@117.72.87.16
  YAHOO_SSH_KEY                Default: $HOME/.ssh/jingdong.pem if it exists;
                              otherwise use SSH config / agent.
  YAHOO_REMOTE_USER            Default: wangming
  YAHOO_REMOTE_APP             Default: /home/wangming/project/goods_hunter
  YAHOO_LOGIN_TIMEOUT_SECONDS  Default: 14400 (4 hours)

Requires a working local DISPLAY, ssh and xauth. The server must already have
tools/yahoo-session/login-x11-remote.sh and the Yahoo session runtime installed.
HELP
}

mode=login
case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  --check) mode=check ;;
  '') ;;
  *) usage >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { usage >&2; exit 2; }
[[ -n "${DISPLAY:-}" ]] || { echo 'No local DISPLAY. Run this from a desktop terminal with an X server.' >&2; exit 1; }
for dependency in ssh xauth; do
  command -v "$dependency" >/dev/null || { echo "Missing local dependency: $dependency" >&2; exit 1; }
done
if command -v xdpyinfo >/dev/null; then
  xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 || { echo 'Cannot connect to the local X server; check DISPLAY and Xauthority.' >&2; exit 1; }
fi

server="${YAHOO_SSH_HOST:-root@117.72.87.16}"
remote_user="${YAHOO_REMOTE_USER:-wangming}"
remote_app="${YAHOO_REMOTE_APP:-/home/wangming/project/goods_hunter}"
timeout="${YAHOO_LOGIN_TIMEOUT_SECONDS:-14400}"
[[ "$timeout" =~ ^[1-9][0-9]{0,4}$ ]] && (( timeout <= 86400 )) || { echo 'Login timeout must be 1–86400 seconds.' >&2; exit 2; }
[[ "$remote_app" == /* ]] || { echo 'YAHOO_REMOTE_APP must be an absolute server path.' >&2; exit 2; }

ssh_options=(-X -T -o BatchMode=yes -o ConnectTimeout=15
  -o "ForwardX11Timeout=$((timeout + 300))s" -o ServerAliveInterval=30 -o ServerAliveCountMax=3)
key="${YAHOO_SSH_KEY:-}"
if [[ -z "$key" && -f "$HOME/.ssh/jingdong.pem" ]]; then key="$HOME/.ssh/jingdong.pem"; fi
if [[ -n "$key" ]]; then
  [[ -r "$key" ]] || { echo 'Cannot read YAHOO_SSH_KEY.' >&2; exit 1; }
  ssh_options+=(-i "$key" -o IdentitiesOnly=yes)
fi
# SSH joins command arguments into a remote shell command. Quote each argument
# for the server's shell, including configurable paths containing spaces.
quote_arg() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
remote_command=bash
for argument in "$remote_app/tools/yahoo-session/login-x11-remote.sh" "$remote_user" "$remote_app" "$mode" "$timeout"; do
  remote_command+=" $(quote_arg "$argument")"
done
echo "Connecting to $server; mode: $mode."
if ssh "${ssh_options[@]}" -- "$server" "$remote_command"; then
  if [[ "$mode" == check ]]; then
    echo 'X11 preflight passed. Run again without --check to open the browser.'
  else
    echo 'Yahoo session saved. The daily refresh timer will use this login.'
  fi
else
  result=$?
  echo 'X11 login did not complete. Check the error above; PROFILE_BUSY means a browser refresh/login is already running.' >&2
  exit "$result"
fi
