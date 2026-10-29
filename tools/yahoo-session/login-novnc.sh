#!/usr/bin/env bash
set -euo pipefail
umask 077
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python_bin="${YAHOO_SESSION_PYTHON:-$script_dir/.venv/bin/python}"
if [[ "${1:-}" != "--inside-xvfb" ]]; then
  for dependency in xvfb-run x11vnc websockify; do
    command -v "$dependency" >/dev/null || { echo "Missing dependency: $dependency" >&2; exit 1; }
  done
  [[ -x "$python_bin" ]] || { echo "Create tools/yahoo-session/.venv first." >&2; exit 1; }
  [[ -f "${YAHOO_NOVNC_WEB:-/usr/share/novnc}/vnc.html" ]] || { echo "Install noVNC or set YAHOO_NOVNC_WEB." >&2; exit 1; }
  exec xvfb-run -a -s '-screen 0 1280x900x24 -nolisten tcp' bash "$0" --inside-xvfb "$@"
fi
shift
vnc_pid=""
web_pid=""
cleanup() {
  [[ -z "$web_pid" ]] || kill "$web_pid" 2>/dev/null || true
  [[ -z "$vnc_pid" ]] || kill "$vnc_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Both endpoints stay on loopback; access only through an SSH tunnel.
x11vnc -display "$DISPLAY" -auth "$XAUTHORITY" -listen 127.0.0.1 -rfbport 5901 -forever -shared -nopw -quiet >/dev/null 2>&1 &
vnc_pid=$!
websockify --web "${YAHOO_NOVNC_WEB:-/usr/share/novnc}" 127.0.0.1:6080 127.0.0.1:5901 >/dev/null 2>&1 &
web_pid=$!
sleep 1
kill -0 "$vnc_pid" "$web_pid" 2>/dev/null || { echo "Remote display could not start; check whether ports 5901/6080 are already in use." >&2; exit 1; }
echo 'SSH tunnel: ssh -N -L 6080:127.0.0.1:6080 user@server'
echo 'Open http://127.0.0.1:6080/vnc.html locally. The display closes after successful login.'
"$python_bin" "$script_dir/session_manager.py" login "$@"
