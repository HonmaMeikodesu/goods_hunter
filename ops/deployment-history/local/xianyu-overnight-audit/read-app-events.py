from pathlib import Path
import json,re
root=Path('/home/wangming/project/goods_hunter');ids={'eb079c34-e571-4a48-88ba-8f9a158eb999':'本间芽衣子','14f07282-ef01-464d-8854-20b4cab494be':'那朵花 未闻花'}
events={};files=[f for f in (root/'logs').rglob('*') if f.is_file()];files+=[root.parent/'.goods_hunter-deployments/xianyu-20261103-b8e74a427dde/runtime-after.log']
pattern=re.compile(r'(2026-11-03 \d\d:\d\d:\d\d(?:\.\d+)?) .*?闲鱼 task ('+'|'.join(ids)+r')(?:: scan accepted (\d+) items| failed: ([^\r\n]*))')
for f in files:
 with f.open(errors='replace') as lines:
  for line in lines:
   match=pattern.search(re.sub(r'\x1b\[[0-9;]*m','',line))
   if not match:continue
   stamp,id,count,error=match.groups()
   if stamp[:19]<'2026-11-03 00:00:00' or stamp[:19]>='2026-11-03 10:26:00':continue
   event={'at':stamp,'id':id,'keyword':ids[id],'success':count is not None,'items':int(count) if count is not None else None,'error':error or None}
   events[(stamp,id)]=event
print(json.dumps({'timezone':'Asia/Shanghai','windowEnd':'2026-11-03 10:26:00','events':sorted(events.values(),key=lambda x:x['at'])},ensure_ascii=False))
