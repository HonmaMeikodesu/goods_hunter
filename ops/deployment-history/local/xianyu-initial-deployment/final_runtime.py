from pathlib import Path
import hashlib,json,os,re,time,urllib.request
root=Path('/home/wangming/project/.goods_hunter-deployments/xianyu-20261103-b8e74a427dde');app=Path('/home/wangming/project/goods_hunter')
active=json.loads((root/'active-process.json').read_text());pid=active['pid'];p=Path('/proc')/str(pid)
assert p.exists() and os.readlink(p/'cwd')==str(app)
env=dict(s.split('=',1) for s in (p/'environ').read_bytes().decode().split('\0') if '=' in s)
original=json.loads((root/'runtime.json').read_text())
assert all(env.get(k)==original['env'].get(k) for k in ['YAHOO_SESSION_FILE','YAHOO_SESSION_MAX_AGE_SECONDS'])
source_files=[n for n in json.loads((root/'app-manifest.json').read_text()) if n.startswith(('src/','view/')) or n=='package.json']
assert all((app/n).read_bytes()==(root/'stage'/n).read_bytes() for n in source_files),'Live source differs from release'
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
with opener.open('http://127.0.0.1:7001/',timeout=5) as r:status=r.status
ids=[t['id'] for t in json.loads((root/'task-registration.json').read_text())['tasks']]
files=[root/'runtime-after.log']
if (app/'logs').exists():files += [f for f in (app/'logs').rglob('*') if f.is_file() and f.stat().st_mtime>time.time()-7200]
patterns=[re.compile(r'(?:闲鱼 )?task '+re.escape(id)+r'[^\r\n]*') for id in ids]
events=[]
for f in files:
 with f.open('r',errors='replace') as inp:
  for line in inp:
   for pattern in patterns:
    m=pattern.search(line)
    if m:
     msg=re.sub(r'\x1b\[[0-9;]*m','',m.group(0))[:500]
     stamp=re.search(r'2026-\d\d-\d\d[ T]\d\d:\d\d:\d\d',line)
     stamp=stamp.group(0) if stamp else None
     if not any(e['event']==msg and e['at']==stamp for e in events):events.append({'file':str(f),'at':stamp,'event':msg})
assert all(any('task '+id+' spawned' in e['event'] for e in events) for id in ids),'Scheduler startup evidence missing'
report={'httpStatus':status,'launcherPid':pid,'sourceFilesMatchRelease':True,'yahooSessionEnvironmentPreserved':True,'taskEvents':events,'rollout':json.loads((root/'rollout-result.json').read_text()),'live':json.loads((root/'live-verification.json').read_text())}
(root/'runtime-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));os.chmod(root/'runtime-verification.json',0o600)
print(json.dumps(report,ensure_ascii=False))
