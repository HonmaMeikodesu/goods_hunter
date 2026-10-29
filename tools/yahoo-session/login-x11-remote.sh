#!/usr/bin/env bash
# Invoked by login-x11.sh on the server. Never runs Chrome as root.
set -euo pipefail
umask 077
[[ $# == 4 ]] || { echo 'Use login-x11.sh from your workstation.' >&2; exit 2; }
remote_user=$1
app=$2
mode=$3
timeout=$4
[[ "$mode" == login || "$mode" == check ]] || exit 2
[[ "$timeout" =~ ^[1-9][0-9]{0,4}$ ]] && (( timeout <= 86400 )) || exit 2
[[ "$app" == /* && -n "${DISPLAY:-}" ]] || { echo 'An absolute app path and SSH X11 forwarding are required.' >&2; exit 1; }
for dependency in xauth xdpyinfo getent; do
  command -v "$dependency" >/dev/null || { echo "Missing server dependency: $dependency" >&2; exit 1; }
done
account="$(getent passwd "$remote_user")" || { echo 'Session owner does not exist.' >&2; exit 1; }
IFS=: read -r account_name _ account_uid account_gid _ account_home _ <<< "$account"
[[ "$account_name" == "$remote_user" && "$account_uid" != 0 ]] || { echo 'Session owner must be a non-root account.' >&2; exit 1; }
if (( EUID != 0 )) && [[ "$EUID" != "$account_uid" ]]; then
  echo 'SSH as the session owner or root to transfer the X11 authorization.' >&2; exit 1
fi
as_user() {
  if (( EUID == 0 )); then runuser -u "$remote_user" -- "$@"; else "$@"; fi
}
auth_file="$(mktemp /tmp/goods-hunter-x11.XXXXXX)"
trap 'rm -f -- "$auth_file"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
xauth extract "$auth_file" "$DISPLAY"
[[ -s "$auth_file" ]] || { echo 'SSH did not supply an X11 authorization cookie.' >&2; exit 1; }
if (( EUID == 0 )); then chown "$account_uid:$account_gid" "$auth_file"; fi
as_user env DISPLAY="$DISPLAY" XAUTHORITY="$auth_file" xdpyinfo >/dev/null
echo 'X11 forwarding verified for the session owner.'

# Load the existing server configuration as the application user, never as root.
# The deployed env file uses shell-compatible KEY=value assignments.
as_user bash -s -- "$app" "$account_home" "$mode" "$timeout" "$DISPLAY" "$auth_file" <<'SESSION'
set -euo pipefail
set +x
app=$1
session_home=$2
mode=$3
timeout=$4
forwarded_display=$5
forwarded_auth=$6
env_file="$session_home/.config/goods-hunter/yahoo-session.env"
[[ -r "$env_file" ]] || { echo 'Missing server Yahoo session environment file.' >&2; exit 1; }
set -a
source "$env_file"
set +a
export DISPLAY="$forwarded_display" XAUTHORITY="$forwarded_auth"
export HOME="$session_home"
[[ -n "${YAHOO_SESSION_DIR:-}" && "$YAHOO_SESSION_DIR" == /* ]] || { echo 'YAHOO_SESSION_DIR must identify the existing profile directory.' >&2; exit 1; }
python_bin="$app/tools/yahoo-session/.venv/bin/python"
manager="$app/tools/yahoo-session/session_manager.py"
[[ -x "$python_bin" && -r "$manager" ]] || { echo 'Server session runtime is not installed.' >&2; exit 1; }
cd "$app"
if [[ "$mode" == check ]]; then
  exec "$python_bin" "$manager" status
fi
echo 'Complete Yahoo login in the X11 window. Successful validation saves the session and closes Chrome.'
exec "$python_bin" "$manager" login --login-timeout "$timeout"
SESSION
