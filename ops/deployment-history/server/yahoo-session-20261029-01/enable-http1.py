from pathlib import Path
import os
app=Path('/home/wangming/project/goods_hunter')
root=Path('/home/wangming/project/.goods_hunter-deployments/yahoo-session-20261029-01')
p=Path('/home/wangming/.config/goods-hunter/yahoo-session.env')
s=p.read_text();lines=[x for x in s.splitlines() if not x.startswith('YAHOO_BROWSER_DISABLE_HTTP2=')];p.write_text('\n'.join(lines)+'\nYAHOO_BROWSER_DISABLE_HTTP2=1\n');p.chmod(0o600);os.chown(p,1000,1000)
p=root/'login-x11.sh';s=p.read_text();s=s.replace('YAHOO_BROWSER_PROXY=http://127.0.0.1:17890','YAHOO_BROWSER_DISABLE_HTTP2=1 YAHOO_BROWSER_PROXY=http://127.0.0.1:17890');p.write_text(s)
for name in ['session_manager.py','test_session_manager.py']:os.chown(app/'tools/yahoo-session'/name,1000,1000)
print('Enabled HTTP/1.1 compatibility for refresh and X11 login.')
