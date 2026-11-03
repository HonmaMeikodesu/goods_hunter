from pathlib import Path
import json,os,re,subprocess,urllib.request,datetime
APP=Path('/home/wangming/project/goods_hunter');ROOT=APP.parent/'.goods_hunter-deployments/xianyu-20261103-images-705bdcf29fa2';NODE='/home/wangming/.nvm/versions/node/v23.11.0/bin/node'
a=json.loads((ROOT/'active-process.json').read_text());p=Path('/proc')/str(a['pid']);assert p.exists() and os.readlink(p/'cwd')==str(APP)
state=json.loads((ROOT/'runtime.json').read_text());env=dict(s.split('=',1) for s in (p/'environ').read_bytes().decode().split('\0') if '=' in s);assert env==state['env']
for n in ['src/service/hunterArsenal/xianyu.ts','view/xianyu/goodsList.ejs']:assert (APP/n).read_bytes()==(ROOT/'stage'/n).read_bytes()
listening=subprocess.check_output(['ss','-ltnpH','sport = :7001'],text=True);workers=set(int(x) for x in re.findall(r'pid=(\d+)',listening));assert len(workers)==1;worker=next(iter(workers));ancestor=worker
for _ in range(12):
 if ancestor==a['pid']:break
 ancestor=int((Path('/proc')/str(ancestor)/'stat').read_text().rpartition(')')[2].split()[1])
else:raise RuntimeError('HTTP worker is not owned by new launcher')
plan=json.loads((ROOT/'plan.json').read_text());ids={t['id'] for t in plan['tasks']};found=set();events=[]
for f in [ROOT/'runtime-after.log']+[f for f in (APP/'logs').rglob('*') if f.is_file()]:
 with f.open(errors='replace') as lines:
  for line in lines:
   if f'INFO {worker} ' not in line:continue
   for id in ids:
    if 'task '+id+' spawned' in line and id not in found:found.add(id);events.append(re.sub(r'\x1b\[[0-9;]*m','',line.strip()))
assert found==ids,'New worker scheduler startup not confirmed'
with urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:7001/',timeout=5) as r:status=r.status
subprocess.run([NODE,str(ROOT/'task-settings.cjs'),'verify'],stdout=subprocess.DEVNULL,check=True)
report={'checkedAt':datetime.datetime.now().astimezone().isoformat(),'httpStatus':status,'launcherPid':a['pid'],'workerPid':worker,'runtimeEnvironmentPreserved':True,'sourceAndTemplateMatchRelease':True,'bothTasksLoaded':True,'startupEvents':events,'liveTaskSettings':json.loads((ROOT/'task-settings-verify.json').read_text()),'imageRepair':json.loads((ROOT/'image-repair-result.json').read_text())}
(ROOT/'runtime-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
