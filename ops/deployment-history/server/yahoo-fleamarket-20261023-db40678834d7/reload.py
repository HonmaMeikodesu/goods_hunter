from pathlib import Path
import ast,json,os,re,subprocess,time,urllib.request
ROOT=Path('/home/wangming/project/.goods_hunter-deployments/yahoo-fleamarket-20261023-db40678834d7')
APP=Path('/home/wangming/project/goods_hunter')
receipt=json.loads((ROOT/'task-registration-20261023.json').read_text())
assert len(receipt['tasks'])==2 and all(task.get('initialized') for task in receipt['tasks'])
pid=json.loads((ROOT/'active-process.json').read_text())['pid']
p=Path('/proc')/str(pid)
assert os.readlink(p/'cwd')==str(APP)
status=dict(line.split(':',1) for line in (p/'status').read_text().splitlines() if ':' in line)
state={'pid':pid,'cwd':str(APP),'exe':os.readlink(p/'exe'),'argv':[s.decode() for s in (p/'cmdline').read_bytes().split(b'\0') if s], 'env':dict(s.decode().split('=',1) for s in (p/'environ').read_bytes().split(b'\0') if b'=' in s),'uid':int(status['Uid'].split()[0]),'gid':int(status['Gid'].split()[0]),'groups':[int(g) for g in status['Groups'].split()]}
audit=ROOT/'task-registration-runtime.json';audit.write_text(json.dumps(state));os.chmod(audit,0o600)
# Reuse the restart functions already validated during deployment, without
# executing the release-file copy or configuration-update parts of that script.
module=ast.parse((ROOT/'rollout.py').read_text())
functions=[n for n in module.body if isinstance(n,(ast.Import,ast.ImportFrom)) or (isinstance(n,ast.FunctionDef) and n.name in ('process','tree','same_process','stop','start','ready'))]
namespace=globals().copy();namespace['opener']=urllib.request.build_opener(urllib.request.ProxyHandler({}))
exec(compile(ast.Module(body=functions,type_ignores=[]),str(ROOT/'rollout.py'),'exec'),namespace)
new=None
try:
 namespace['stop'](pid)
 new=namespace['start']('tasks-20261023')
 namespace['ready'](new)
 print('Application reloaded with the two registered tasks',flush=True)
except Exception:
 if new is None and namespace['process'](pid):
  print('Original launcher remains present; no duplicate launcher started',flush=True)
  raise
 if new is not None:namespace['stop'](new.pid)
 recovery=namespace['start']('tasks-recovery-20261023')
 namespace['ready'](recovery)
 raise
