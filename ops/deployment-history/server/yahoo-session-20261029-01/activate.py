from pathlib import Path
import ast, hashlib, json, os, shutil, subprocess, tarfile, time, urllib.request

ROOT=Path('/home/wangming/project/.goods_hunter-deployments/yahoo-session-20261029-01')
PREVIOUS=Path('/home/wangming/project/.goods_hunter-deployments/yahoo-fleamarket-20261023-db40678834d7')
APP=Path('/home/wangming/project/goods_hunter')
NODE='/home/wangming/.nvm/versions/node/v23.11.0/bin/node'
SESSION=Path('/home/wangming/.local/share/goods-hunter/yahoo-session/session.json')
os.umask(0o077)
managed=json.loads(SESSION.read_text())
assert managed.get('status')=='ready' and managed.get('cookies'), 'Successful manual login and headless validation required'
subprocess.check_call([NODE,str(ROOT/'check-candidate.cjs')])
expected=json.loads((ROOT/'expected.json').read_text())
assert all(hashlib.sha256((APP/name).read_bytes()).hexdigest()==digest for name,digest in expected.items()), 'Application baseline changed'
pid=json.loads((PREVIOUS/'active-process.json').read_text())['pid']
p=Path('/proc')/str(pid)
assert os.readlink(p/'cwd')==str(APP)
status=dict(line.split(':',1) for line in (p/'status').read_text().splitlines() if ':' in line)
state={'pid':pid,'cwd':str(APP),'exe':os.readlink(p/'exe'),
       'argv':[s.decode() for s in (p/'cmdline').read_bytes().split(b'\0') if s],
       'env':dict(s.decode().split('=',1) for s in (p/'environ').read_bytes().split(b'\0') if b'=' in s),
       'uid':int(status['Uid'].split()[0]),'gid':int(status['Gid'].split()[0]),
       'groups':[int(g) for g in status['Groups'].split()]}
assert state['uid']==1000
(ROOT/'runtime-before.json').write_text(json.dumps(state))
original_env=state['env'].copy()
state['env']['YAHOO_SESSION_FILE']=str(SESSION)
if os.environ.get('YAHOO_AUTH_SELECTOR'): state['env']['YAHOO_AUTH_SELECTOR']=os.environ['YAHOO_AUTH_SELECTOR']
names=['api/site/yahoo/index','api/site/yahoo/session','service/hunterArsenal/yahoo','config/config.default']
files=['src/'+name+'.ts' for name in names]+['dist/'+name+'.js' for name in names]
backup_names=files+['dist/'+name+'.d.ts' for name in names]
added=[name for name in backup_names if not (APP/name).exists()]
with tarfile.open(ROOT/'activation-before.tar.gz','w:gz') as archive:
 for name in backup_names:
  if (APP/name).exists():archive.add(APP/name,arcname=name)
(ROOT/'activation-added.json').write_text(json.dumps(added))
module=ast.parse((PREVIOUS/'rollout.py').read_text())
functions=[n for n in module.body if isinstance(n,(ast.Import,ast.ImportFrom)) or (isinstance(n,ast.FunctionDef) and n.name in ('process','tree','same_process','stop','start','ready'))]
namespace=globals().copy();namespace['opener']=urllib.request.build_opener(urllib.request.ProxyHandler({}))
exec(compile(ast.Module(body=functions,type_ignores=[]),str(PREVIOUS/'rollout.py'),'exec'),namespace)
control=['runuser','-u','wangming','--','env','XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus','systemctl','--user']
new=None
try:
 namespace['stop'](pid)
 for name in files:
  source=(ROOT/'stage' if name.startswith('src/') else ROOT/'candidate')/name
  target=APP/name
  shutil.copy2(source,target);os.chown(target,state['uid'],state['gid'])
 new=namespace['start']('yahoo-session')
 namespace['ready'](new)
 subprocess.check_call(control+['enable','--now','yahoo-session.timer'])
 (PREVIOUS/'active-process.json').write_text(json.dumps({'pid':new.pid,'label':'yahoo-session-20261029'}))
 (ROOT/'activated.json').write_text(json.dumps({'success':True,'pid':new.pid,'timestamp':time.time(),'managedSession':str(SESSION)}))
 print('Managed Yahoo session activated and timer enabled; application health passed.')
except Exception:
 subprocess.run(control+['disable','--now','yahoo-session.timer'],check=False)
 if new is not None:namespace['stop'](new.pid)
 for name in added:
  if (APP/name).exists():(APP/name).unlink()
 with tarfile.open(ROOT/'activation-before.tar.gz') as archive:archive.extractall(APP)
 state['env']=original_env
 recovery=namespace['start']('yahoo-session-rollback');namespace['ready'](recovery)
 (PREVIOUS/'active-process.json').write_text(json.dumps({'pid':recovery.pid,'label':'yahoo-session-rollback'}))
 print('Activation failed; previous application and credentials configuration restored.')
 raise
