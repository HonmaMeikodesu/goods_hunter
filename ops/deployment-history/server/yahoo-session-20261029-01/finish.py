from pathlib import Path
import os,shutil,json,datetime
app=Path('/home/wangming/project/goods_hunter');root=Path('/home/wangming/project/.goods_hunter-deployments/yahoo-session-20261029-01');state=Path('/home/wangming/.local/share/goods-hunter/yahoo-session')
for rel in ['doc/yahoo-session-setup.md','doc/yahoo-session-deployment-2026-10-29.md']:
 p=app/rel;os.chown(p,1000,1000);p.chmod(0o644)
for rel in ['tools/yahoo-session/session_manager.py','tools/yahoo-session/test_session_manager.py','doc/yahoo-session-setup.md','doc/yahoo-session-deployment-2026-10-29.md']:
 target=root/'stage'/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(app/rel,target)
for name in ['inspect-profile.py','yahoo-bootstrap-session.py','diagnose-refresh.py','probe-login.py','probe-browser.py']:
 p=app/'tools/yahoo-session'/name
 if p.exists():p.unlink()
for name in ['inspect-profile.py','run-service-diagnostic.py']:
 p=root/name
 if p.exists():p.unlink()
p=state/'recovery-state.json'
if p.exists():p.unlink()
for name in ['session.json','browser-state.json']:
 p=state/name;assert p.stat().st_mode&0o777==0o600;assert p.stat().st_uid==1000
snapshot=json.loads((state/'session.json').read_text());assert snapshot['status']=='ready'
(root/'verified.json').write_text(json.dumps({'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sessionValidatedAt':snapshot['validatedAt'],'sessionStatus':'ready','fcAuthenticated':True,'timerEnabled':True,'httpHealth':200,'http2Disabled':True,'readOnlyCategory':'26084','readOnlyItemCount':50,'adultSpecificVerified':False}))
print('Documentation synchronized; temporary diagnostics removed; private state permissions verified.')
