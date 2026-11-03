from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,tarfile
ROOT=Path(__file__).resolve().parent
APP=Path('/home/wangming/project/goods_hunter')
STAGE=ROOT/'stage'
EXPECTED='3993847e0bc38785456bf8f3cdcf94843e0ed078'
def save(name,value):
 p=ROOT/name;p.write_text(json.dumps(value,ensure_ascii=False,indent=2));os.chmod(p,0o600)
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=APP,text=True).strip()==EXPECTED
assert not subprocess.check_output(['git','status','--porcelain'],cwd=APP,text=True).strip(),'Live checkout changed before staging'
assert not (ROOT/'runtime.json').exists(),'Deployment already prepared; inspect existing state instead of recreating backup'
STAGE.mkdir(mode=0o700)
with tarfile.open(ROOT/'app-release.tar.gz') as archive:
 for m in archive.getmembers():
  assert m.isfile() and not Path(m.name).is_absolute() and '..' not in Path(m.name).parts
  assert not m.name.startswith(('src/private/','dist/private/'))
 archive.extractall(STAGE)
(STAGE/'node_modules').symlink_to(APP/'node_modules',target_is_directory=True)
for prefix in ('src/private','dist/private'):
 target=STAGE/prefix;target.mkdir(parents=True,exist_ok=True)
 for source in (APP/prefix).glob('*.json'):
  shutil.copy2(source,target/source.name);os.chmod(target/source.name,0o600)
listening=subprocess.check_output(['ss','-ltnpH','sport = :7001'],text=True)
pids=[int(x) for x in re.findall(r'pid=(\d+)',listening)]
assert len(set(pids))==1
pid=pids[0]
for _ in range(10):
 p=Path('/proc')/str(pid);argv=(p/'cmdline').read_bytes().decode().rstrip('\0').split('\0')
 if argv[-2:]==['run','dev'] and 'bun' in argv[0]:break
 pid=int((p/'stat').read_text().rpartition(')')[2].split()[1])
else:raise RuntimeError('Existing application launcher was not found')
p=Path('/proc')/str(pid)
assert os.readlink(p/'cwd')==str(APP)
status={line.split(':',1)[0]:line.split(':',1)[1].strip() for line in (p/'status').read_text().splitlines() if ':' in line}
state={'pid':pid,'exe':os.readlink(p/'exe'),'argv':argv,'env':dict(x.split('=',1) for x in (p/'environ').read_bytes().decode().split('\0') if '=' in x),'uid':int(status['Uid'].split()[0]),'gid':int(status['Gid'].split()[0]),'groups':[int(x) for x in status['Groups'].split()],'start':(p/'stat').read_text().rpartition(')')[2].split()[19]}
save('runtime.json',state)
manifest=json.loads((ROOT/'app-manifest.json').read_text())
assert all((STAGE/n).is_file() for n in manifest)
backup=manifest+['src/private/alicloud.json','dist/private/alicloud.json']
existing=[n for n in backup if (APP/n).exists()]
save('added-files.json',[n for n in manifest if not (APP/n).exists()])
save('checksums.json',{n:hashlib.sha256((APP/n).read_bytes()).hexdigest() for n in existing})
with tarfile.open(ROOT/'before.tar.gz','w:gz') as archive:
 for n in existing:archive.add(APP/n,arcname=n,recursive=False)
os.chmod(ROOT/'before.tar.gz',0o600)
print(json.dumps({'prepared':True,'files':len(manifest),'oldLauncherPid':pid,'uid':state['uid'],'yahooSessionEnvironmentPreserved':bool(state['env'].get('YAHOO_SESSION_FILE'))}))
