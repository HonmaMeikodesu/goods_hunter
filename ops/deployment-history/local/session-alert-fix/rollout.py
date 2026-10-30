"""One-off 2026-10-30 rollout. Run as root on the existing application host.

Usage: python3 rollout.py /tmp/release.bundle COMMIT
Only runtime receipts/logs remain outside Git. Never print the captured environment.
"""
from pathlib import Path
import ast
import json
import os
import pwd
import subprocess
import sys
import time
import urllib.request

os.umask(0o077)
APP = Path('/home/wangming/project/goods_hunter')
PREVIOUS = APP.parent / '.goods_hunter-deployments/yahoo-fleamarket-20261023-db40678834d7'
ROOT = APP.parent / '.goods_hunter-deployments/yahoo-alert-20261030'
ROOT.mkdir(mode=0o700, exist_ok=True)
bundle, target = sys.argv[1:]
owner = pwd.getpwuid((APP / '.git').stat().st_uid).pw_name

def git(*args):
    return subprocess.check_output(['runuser', '-u', owner, '--', 'git', '-C', str(APP), *args], text=True).strip()

assert not git('status', '--porcelain'), 'Live repository has uncommitted changes'
old_head = git('rev-parse', 'HEAD')
assert git('branch', '--show-current') == 'main'
git('fetch', bundle, 'main:refs/remotes/origin/main')
assert git('rev-parse', 'origin/main') == target
assert git('merge-base', old_head, target) == old_head
allowed = {'src/service/hunterArsenal/yahoo.ts', 'test/yahooSession/session.test.ts',
           'doc/yahoo-session-setup.md', 'doc/yahoo-session-alert-incident-2026-10-30.md',
           'ops/deployment-history/local/session-alert-fix/rollout.py'}
assert set(git('diff', '--name-only', old_head, target).splitlines()) <= allowed
pid = json.loads((PREVIOUS / 'active-process.json').read_text())['pid']
p = Path('/proc') / str(pid)
assert os.readlink(p / 'cwd') == str(APP)
status = dict(line.split(':', 1) for line in (p / 'status').read_text().splitlines() if ':' in line)
state = {'exe': os.readlink(p / 'exe'),
         'argv': [s.decode() for s in (p / 'cmdline').read_bytes().split(b'\0') if s],
         'env': dict(s.decode().split('=', 1) for s in (p / 'environ').read_bytes().split(b'\0') if b'=' in s),
         'uid': int(status['Uid'].split()[0]), 'gid': int(status['Gid'].split()[0]),
         'groups': [int(g) for g in status['Groups'].split()]}
assert state['uid'] == 1000
assert state['env'].get('YAHOO_SESSION_MAX_AGE_SECONDS') == '172800'
(ROOT / 'runtime-before.json').write_text(json.dumps(state))
# Reuse the audited process-tree stop/start/HTTP-health routines, never execute
# the historical script's top-level deployment or configuration mutations.
source = APP / 'ops/deployment-history/server/yahoo-fleamarket-20261023-db40678834d7/rollout.py'
module = ast.parse(source.read_text())
functions = [n for n in module.body if isinstance(n, (ast.Import, ast.ImportFrom)) or
             isinstance(n, ast.FunctionDef) and n.name in ('process', 'tree', 'same_process', 'stop', 'start', 'ready')]
namespace = globals().copy()
namespace['opener'] = urllib.request.build_opener(urllib.request.ProxyHandler({}))
exec(compile(ast.Module(body=functions, type_ignores=[]), 'rollout-functions', 'exec'), namespace)

def receipt(child, label, commit):
    data = {'pid': child.pid, 'label': label, 'commit': commit, 'timestamp': time.time()}
    (PREVIOUS / 'active-process.json').write_text(json.dumps(data))
    activated = APP.parent / '.goods_hunter-deployments/yahoo-session-20261029-01/activated.json'
    previous = json.loads(activated.read_text())
    previous.update(data)
    activated.write_text(json.dumps(previous))
    (ROOT / 'result.json').write_text(json.dumps(data))

new = None
try:
    namespace['stop'](pid)
    git('merge', '--ff-only', target)
    new = namespace['start']('alert-fix')
    namespace['ready'](new)
    assert not git('status', '--porcelain')
    receipt(new, 'yahoo-alert-fix', target)
    print('Alert fix deployed; repository clean; HTTP health passed.')
except Exception:
    if new is not None:
        namespace['stop'](new.pid)
    git('reset', '--keep', old_head)
    recovered = namespace['start']('alert-rollback')
    namespace['ready'](recovered)
    receipt(recovered, 'yahoo-alert-rollback', old_head)
    raise
