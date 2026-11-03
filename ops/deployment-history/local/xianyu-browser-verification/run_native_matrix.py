import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

root = Path('/home/admin/Documents/Codex/2026-11-02/new-chat-2')
env = os.environ.copy()
for key in ('http_proxy','https_proxy','HTTP_PROXY','HTTPS_PROXY','all_proxy','ALL_PROXY'):
    env.pop(key, None)
env['no_proxy'] = env['NO_PROXY'] = '*'
with socket.socket() as reservation:
    reservation.bind(('127.0.0.1', 0))
    port = reservation.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='goods-hunter-native-', dir='/tmp') as profile:
    chrome_args = ['/usr/bin/google-chrome', f'--remote-debugging-port={port}', f'--user-data-dir={profile}', '--no-proxy-server', '--no-first-run', '--no-default-browser-check', '--window-size=1365,900', '--disk-cache-size=16777216', 'about:blank']
    if os.getuid() == 0:
        raise RuntimeError('Native Chrome must run as the desktop user with its normal sandbox')
    chrome = subprocess.Popen(chrome_args, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        endpoint = f'http://127.0.0.1:{port}'
        for _ in range(50):
            if chrome.poll() is not None:
                raise RuntimeError('Native Chrome exited before becoming ready')
            try:
                with opener.open(endpoint + '/json/version', timeout=1) as response:
                    json.load(response)
                break
            except Exception:
                time.sleep(0.2)
        else:
            raise RuntimeError('Native Chrome startup timed out')
        info = {'desktopDisplay': env.get('DISPLAY'), 'headless': False, 'proxyDisabled': True, 'sandboxDisabled': False, 'profile': 'fresh temporary profile', 'chromeVersion': subprocess.check_output(['/usr/bin/google-chrome','--version'],text=True).strip()}
        (root / 'outputs/xianyu-native-runtime.json').write_text(json.dumps(info, ensure_ascii=False, indent=2))
        print('[XIANYU-MATRIX] NATIVE_RUNTIME ' + json.dumps(info, ensure_ascii=False), flush=True)
        command = ['docker','run','--rm','--pull=never','--name','goods-hunter-xianyu-native-driver-20261102','--network=host','--read-only','--memory=768m','--cpus=1','--tmpfs','/tmp:rw,nosuid,size=128m','--tmpfs','/root:rw,nosuid,size=32m','-e','PROXY_ENABLED=false','-e','PYTHONDONTWRITEBYTECODE=1']
        for source, destination, readonly in [
            ('/home/admin/project/bypass-cloudflare/bypass_cloudflare.py','/app/bypass_cloudflare.py', True),
            ('/home/admin/project/bypass-cloudflare/docker-entrypoint.sh','/usr/local/bin/docker-entrypoint.sh', True),
            (str(root / 'work/xianyu-smoke/xianyu_matrix.py'),'/smoke/xianyu_matrix.py',True),
            (str(root / 'outputs'),'/artifacts',False),
        ]:
            command += ['--mount',f'type=bind,src={source},dst={destination}' + (',readonly' if readonly else '')]
        command += ['--entrypoint','bash','bypass-cloudflare:latest','/usr/local/bin/docker-entrypoint.sh','python','-u','/smoke/xianyu_matrix.py','--external-cdp',endpoint]
        result = subprocess.run(command, env=env, timeout=210)
        sys.exit(result.returncode)
    finally:
        if chrome.poll() is None:
            os.killpg(chrome.pid, signal.SIGTERM)
            try:
                chrome.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(chrome.pid, signal.SIGKILL)
                chrome.wait()
        print('[XIANYU-MATRIX] Native test browser closed; temporary profile removed.', flush=True)
