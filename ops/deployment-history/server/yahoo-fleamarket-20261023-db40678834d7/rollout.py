from pathlib import Path
import hashlib,json,os,re,shutil,signal,subprocess,tarfile,tempfile,time,urllib.request
ROOT=Path('/home/wangming/project/.goods_hunter-deployments/yahoo-fleamarket-20261023-db40678834d7')
APP=Path('/home/wangming/project/goods_hunter')
STAGE=ROOT/'stage'
URL='https://fetch-yeamarket-cuqfwgngdv.cn-hangzhou.fcapp.run/search'
state=json.loads((ROOT/'runtime.json').read_text())
manifest=json.loads((ROOT/'app-manifest.json').read_text())
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))

def process(pid):
 try:
  p=Path('/proc')/str(pid)
  fields=(p/'stat').read_text().rpartition(')')[2].split()
  return {'pid':pid,'parent':int(fields[1]),'status':fields[0],'start':fields[19]}
 except (FileNotFoundError,ProcessLookupError):return None

def tree(pid):
 all_ps={}
 for p in Path('/proc').iterdir():
  if p.name.isdigit():
   s=process(int(p.name))
   if s:all_ps[s['pid']]=s
 selected={pid}
 while True:
  added={s['pid'] for s in all_ps.values() if s['parent'] in selected}-selected
  if not added:break
  selected|=added
 return {p:all_ps[p] for p in selected if p in all_ps}

def same_process(p):
 current=process(p['pid'])
 return current and current['start']==p['start'] and current['status']!='Z'

def stop(pid):
 targets=tree(pid)
 ordered=[];queue=[pid]
 while queue:
  current=queue.pop(0)
  if current in targets:ordered.append(targets[current]);queue.extend(sorted(p['pid'] for p in targets.values() if p['parent']==current))
 for p in ordered:
  if same_process(p):
   try:os.kill(p['pid'],signal.SIGTERM)
   except ProcessLookupError:pass
 deadline=time.monotonic()+12
 while time.monotonic()<deadline and any(same_process(p) for p in targets.values()):time.sleep(0.2)
 for p in targets.values():
  if same_process(p):
   try:os.kill(p['pid'],signal.SIGKILL)
   except ProcessLookupError:pass
 print('Stopped previous application process tree',len(targets),flush=True)

def start(label):
 def drop_identity():
  os.setgroups(state['groups']);os.setgid(state['gid']);os.setuid(state['uid'])
 logfile=ROOT/f'runtime-{label}.log'
 with logfile.open('ab',buffering=0) as log:
  child=subprocess.Popen([state['exe'],*state['argv'][1:]],cwd=APP,env=state['env'],stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=drop_identity)
 os.chmod(logfile,0o600)
 p=ROOT/'active-process.json';p.write_text(json.dumps({'pid':child.pid,'label':label}));os.chmod(p,0o600)
 print('Started application',child.pid,'as uid',state['uid'],flush=True)
 return child

def ready(child):
 deadline=time.monotonic()+60
 while time.monotonic()<deadline:
  if child.poll() is not None:raise RuntimeError(f'Application launcher exited with {child.returncode}')
  try:
   listening=subprocess.check_output(['ss','-ltnpH','sport = :7001'],text=True)
   owned={int(p) for p in re.findall(r'pid=(\d+)',listening)} & set(tree(child.pid))
   if not owned:time.sleep(0.5);continue
   with opener.open('http://127.0.0.1:7001/',timeout=1) as r:
    if r.status==200:
     print('Application HTTP health passed',flush=True);return
  except Exception:pass
  time.sleep(0.5)
 raise RuntimeError('Application did not become ready in 60 seconds')

def configure():
 for name in ('src/private/alicloud.json','dist/private/alicloud.json'):
  target=APP/name
  old=target.stat();data=json.loads(target.read_text());data['yahooFleamarketUrl']=URL
  with tempfile.NamedTemporaryFile('w',dir=target.parent,delete=False) as out:
   json.dump(data,out,indent=2);out.write('\n');tmp=Path(out.name)
  os.chmod(tmp,old.st_mode&0o777);os.chown(tmp,old.st_uid,old.st_gid);os.replace(tmp,target)
 print('Configured dedicated FC endpoint in source and runtime config',flush=True)

def copy_release():
 new_dirs=set()
 for name in manifest:
  source=STAGE/name;target=APP/name
  assert source.is_file() and '..' not in Path(name).parts and not Path(name).is_absolute()
  current=target.parent
  while not current.exists():new_dirs.add(current);current=current.parent
  target.parent.mkdir(parents=True,exist_ok=True)
  shutil.copy2(source,target);os.chown(target,state['uid'],state['gid'])
 for p in new_dirs:os.chown(p,state['uid'],state['gid'])
 print('Installed release files',len(manifest),flush=True)

def restore():
 for name in json.loads((ROOT/'added-files.json').read_text()):
  p=APP/name
  if p.is_file() or p.is_symlink():p.unlink()
 with tarfile.open(ROOT/'before.tar.gz') as archive:archive.extractall(APP)
 print('Restored pre-deployment application and configuration',flush=True)

checks=json.loads((ROOT/'checksums.json').read_text())
changed=[n for n,h in checks.items() if not (APP/n).is_file() or hashlib.sha256((APP/n).read_bytes()).hexdigest()!=h]
if changed:raise RuntimeError('Live files changed after backup; refusing overwrite: '+repr(changed))
assert len(json.loads((ROOT/'schema-preview.json').read_text()))==4
assert 'proxy: false' in (STAGE/'dist/api/alicloud/index.js').read_text()
old_pid=json.loads((ROOT/'active-process.json').read_text())['pid'] if (ROOT/'active-process.json').exists() else state['pid']
assert os.readlink(Path('/proc')/str(old_pid)/'cwd')==str(APP)
new=None
try:
 stop(old_pid)
 copy_release();configure();new=start('after');ready(new)
 (ROOT/'rollout-result.json').write_text(json.dumps({'success':True,'pid':new.pid,'url':URL,'files':len(manifest),'timestamp':time.time()}))
 print('Deployment rollout completed',flush=True)
except Exception:
 if new is not None:stop(new.pid)
 restore();rollback=start('rollback');ready(rollback)
 print('Deployment was rolled back',flush=True)
 raise
