from pathlib import Path
import ast,json,os,subprocess,time,urllib.request,shutil
ROOT=Path('/home/wangming/project/.goods_hunter-deployments/yahoo-session-20261029-01/daily')
ROOT.mkdir(mode=0o700,exist_ok=True);os.umask(0o077)
PREVIOUS=ROOT.parent.parent/'yahoo-fleamarket-20261023-db40678834d7'
APP=Path('/home/wangming/project/goods_hunter')
pid=json.loads((PREVIOUS/'active-process.json').read_text())['pid'];p=Path('/proc')/str(pid)
assert os.readlink(p/'cwd')==str(APP)
status=dict(line.split(':',1) for line in (p/'status').read_text().splitlines() if ':' in line)
state={'pid':pid,'exe':os.readlink(p/'exe'),'argv':[s.decode() for s in (p/'cmdline').read_bytes().split(b'\0') if s],'env':dict(s.decode().split('=',1) for s in (p/'environ').read_bytes().split(b'\0') if b'=' in s),'uid':int(status['Uid'].split()[0]),'gid':int(status['Gid'].split()[0]),'groups':[int(g) for g in status['Groups'].split()]}
assert state['uid']==1000 and state['env'].get('YAHOO_SESSION_FILE')
(ROOT/'runtime-before.json').write_text(json.dumps(state));old_env=state['env'].copy();state['env']['YAHOO_SESSION_MAX_AGE_SECONDS']='172800'
timer=Path('/home/wangming/.config/systemd/user/yahoo-session.timer');old_timer=timer.read_bytes();(ROOT/'timer-before').write_bytes(old_timer)
module=ast.parse((PREVIOUS/'rollout.py').read_text());functions=[n for n in module.body if isinstance(n,(ast.Import,ast.ImportFrom)) or isinstance(n,ast.FunctionDef) and n.name in ('process','tree','same_process','stop','start','ready')]
namespace=globals().copy();namespace['opener']=urllib.request.build_opener(urllib.request.ProxyHandler({}));exec(compile(ast.Module(body=functions,type_ignores=[]),'rollout-functions','exec'),namespace)
ctl=['runuser','-u','wangming','--','env','XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus','systemctl','--user']
new=None
try:
 namespace['stop'](pid);new=namespace['start']('daily');namespace['ready'](new)
 shutil.copy2(ROOT/'yahoo-session.timer',timer);os.chown(timer,1000,1000)
 subprocess.run(ctl+['daemon-reload'],check=True);subprocess.run(ctl+['restart','yahoo-session.timer'],check=True)
 receipt={'pid':new.pid,'label':'yahoo-session-daily','refreshIntervalHours':24,'maxAgeSeconds':172800,'timestamp':time.time()}
 (PREVIOUS/'active-process.json').write_text(json.dumps(receipt));(ROOT/'result.json').write_text(json.dumps(receipt))
 activated=ROOT.parent/'activated.json';data=json.loads(activated.read_text());data.update(receipt);activated.write_text(json.dumps(data))
 print('Daily timer and 48-hour snapshot lifetime activated; HTTP health passed.')
except Exception:
 if new is not None:namespace['stop'](new.pid)
 timer.write_bytes(old_timer);subprocess.run(ctl+['daemon-reload']);subprocess.run(ctl+['restart','yahoo-session.timer'])
 state['env']=old_env;recovered=namespace['start']('daily-rollback');namespace['ready'](recovered)
 (PREVIOUS/'active-process.json').write_text(json.dumps({'pid':recovered.pid,'label':'daily-rollback'}))
 raise
