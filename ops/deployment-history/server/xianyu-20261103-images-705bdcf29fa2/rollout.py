from pathlib import Path
import ast,hashlib,json,os,shutil,subprocess,tarfile,time,urllib.request
ROOT=Path(__file__).resolve().parent;APP=Path('/home/wangming/project/goods_hunter');STAGE=ROOT/'stage'
PREVIOUS=APP.parent/'.goods_hunter-deployments/xianyu-20261103-b8e74a427dde';NODE='/home/wangming/.nvm/versions/node/v23.11.0/bin/node'
state=json.loads((ROOT/'runtime.json').read_text());manifest=json.loads((ROOT/'manifest.json').read_text())
checks=json.loads((ROOT/'checksums.json').read_text());assert all(hashlib.sha256((APP/n).read_bytes()).hexdigest()==h for n,h in checks.items()),'Live files changed after backup'
module=ast.parse((PREVIOUS/'rollout.py').read_text());functions=[n for n in module.body if isinstance(n,(ast.Import,ast.ImportFrom)) or isinstance(n,ast.FunctionDef) and n.name in ('process','tree','same_process','stop','start','ready')]
namespace=globals().copy();namespace['opener']=urllib.request.build_opener(urllib.request.ProxyHandler({}));exec(compile(ast.Module(body=functions,type_ignores=[]),str(PREVIOUS/'rollout.py'),'exec'),namespace)
new=None;applied=False
try:
 namespace['stop'](state['pid'])
 subprocess.run([NODE,str(ROOT/'task-settings.cjs'),'apply'],check=True);applied=True
 for name in manifest:shutil.copy2(STAGE/name,APP/name);os.chown(APP/name,state['uid'],state['gid'])
 new=namespace['start']('after');namespace['ready'](new)
 subprocess.run([NODE,str(ROOT/'task-settings.cjs'),'verify'],check=True)
 result={'success':True,'pid':new.pid,'files':manifest,'checkedAt':time.time()};(ROOT/'rollout-result.json').write_text(json.dumps(result));print(json.dumps(result),flush=True)
except Exception:
 if new is not None:namespace['stop'](new.pid)
 if applied:subprocess.run([NODE,str(ROOT/'task-settings.cjs'),'restore'],check=True)
 with tarfile.open(ROOT/'before.tar.gz') as archive:archive.extractall(APP)
 recovery=namespace['start']('rollback');namespace['ready'](recovery)
 raise
