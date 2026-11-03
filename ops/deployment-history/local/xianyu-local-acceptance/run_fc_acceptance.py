import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request

root=Path('/home/admin/Documents/Codex/2026-11-02/new-chat-2')
name='goods-hunter-xianyu-fc-acceptance-20261103'
image='goods-hunter-xianyu:local-20261103'
command=['docker','run','--rm','--pull=never','--detach','--name',name,'--read-only','--memory=2g','--cpus=1','--shm-size=128m','--tmpfs','/tmp:rw,nosuid,size=256m','--tmpfs','/root:rw,nosuid,size=64m','--tmpfs','/run:rw,nosuid,size=16m','--publish','127.0.0.1::9000','-e','PYTHONDONTWRITEBYTECODE=1',image]
subprocess.run(command,check=True,stdout=subprocess.DEVNULL)
try:
 port=subprocess.check_output(['docker','port',name,'9000/tcp'],text=True).strip().split(':')[-1]
 url='http://127.0.0.1:'+port
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 for _ in range(40):
  try:
   with opener.open(url+'/health',timeout=1) as res:
    assert json.load(res)['source']=='xianyu'
   break
  except Exception: time.sleep(.25)
 else: raise RuntimeError('FC HTTP health endpoint did not start')
 started=time.monotonic()
 req=urllib.request.Request(url+'/search',data=json.dumps({'keyword':'本间芽衣子'}).encode(),headers={'Content-Type':'application/json'})
 try:
  with opener.open(req,timeout=115) as res: status=res.status; body=json.load(res)
 except urllib.error.HTTPError as error:
  status=error.code; body=json.load(error)
 (root/'outputs/xianyu-fc-acceptance.json').write_text(json.dumps({'httpStatus':status,'elapsedSeconds':round(time.monotonic()-started,2),'response':body},ensure_ascii=False,indent=2))
 print(json.dumps({'stage':'FC HTTP','httpStatus':status,'seconds':round(time.monotonic()-started,1),'success':body.get('success'),'items':len(body.get('items',[])),'code':body.get('code')},ensure_ascii=False),flush=True)
 if status!=200: raise RuntimeError('FC did not return a successful snapshot')
 assert body['sort']=='newest' and body['currency']=='CNY' and body['page']==1
 assert body['items'] and all(isinstance(i['priceFen'],int) for i in body['items'])
 # Exercise the actual signed goods_hunter client and filters on the warm FC.
 result=subprocess.run(['node',str(root/'work/implementation/accept_fc.cjs'),url],timeout=115)
 if result.returncode: raise RuntimeError('goods_hunter adapter acceptance failed')
finally:
 logs=subprocess.run(['docker','logs','--tail','24',name],capture_output=True,text=True)
 print(logs.stdout,flush=True)
 subprocess.run(['docker','stop','-t','3',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
