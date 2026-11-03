from pathlib import Path
import hashlib,json,os,re,subprocess,tarfile
ROOT=Path(__file__).resolve().parent;APP=Path('/home/wangming/project/goods_hunter');STAGE=ROOT/'stage'
PREVIOUS=APP.parent/'.goods_hunter-deployments/xianyu-20261103-b8e74a427dde'
assert not (ROOT/'runtime.json').exists(),'Already prepared'
manifest=['src/service/hunterArsenal/xianyu.ts','dist/service/hunterArsenal/xianyu.js','view/xianyu/goodsList.ejs']
for name in manifest:
 if not name.startswith('dist/'):
  assert (APP/name).read_bytes()==(PREVIOUS/'stage'/name).read_bytes(),'Source changed since initial deployment: '+name
STAGE.mkdir(mode=0o700)
with tarfile.open(ROOT/'release.tar.gz') as archive:
 for m in archive.getmembers():assert m.isfile() and m.name in manifest
 archive.extractall(STAGE)
listening=subprocess.check_output(['ss','-ltnpH','sport = :7001'],text=True);pids=[int(x) for x in re.findall(r'pid=(\d+)',listening)];assert len(set(pids))==1;pid=pids[0]
for _ in range(12):
 p=Path('/proc')/str(pid);argv=(p/'cmdline').read_bytes().decode().rstrip('\0').split('\0')
 if argv[-2:]==['run','dev'] and 'bun' in argv[0]:break
 pid=int((p/'stat').read_text().rpartition(')')[2].split()[1])
else:raise RuntimeError('Launcher not found')
assert os.readlink(p/'cwd')==str(APP)
status=dict(line.split(':',1) for line in (p/'status').read_text().splitlines() if ':' in line)
state={'pid':pid,'exe':os.readlink(p/'exe'),'argv':argv,'env':dict(s.split('=',1) for s in (p/'environ').read_bytes().decode().split('\0') if '=' in s),'uid':int(status['Uid'].split()[0]),'gid':int(status['Gid'].split()[0]),'groups':[int(x) for x in status['Groups'].split()]}
def save(name,value):
 path=ROOT/name;path.write_text(json.dumps(value,ensure_ascii=False,indent=2));os.chmod(path,0o600)
save('runtime.json',state);save('manifest.json',manifest);save('checksums.json',{n:hashlib.sha256((APP/n).read_bytes()).hexdigest() for n in manifest})
with tarfile.open(ROOT/'before.tar.gz','w:gz') as archive:
 for name in manifest:archive.add(APP/name,arcname=name,recursive=False)
os.chmod(ROOT/'before.tar.gz',0o600)
print(json.dumps({'prepared':True,'files':len(manifest),'launcherPid':pid,'runtimeUid':state['uid']}))
