from pathlib import Path
import json, os, pwd, shutil, subprocess, yaml

root=Path('/home/wangming/project/.goods_hunter-deployments/yahoo-session-20261029-01')
home=Path('/home/wangming')
user=pwd.getpwnam('wangming')
os.umask(0o077)
proxy=home/'.local/share/goods-hunter/yahoo-proxy'
proxy.mkdir(mode=0o700, exist_ok=True)
shutil.copy2(root/'mihomo',proxy/'mihomo')
(proxy/'mihomo').chmod(0o700)
shutil.copy2(root/'geoip.metadb',proxy/'geoip.metadb')
config=yaml.safe_load((home/'project/goods_hunter/src/private/config.yaml').read_text())
config.update({'mixed-port':17890,'allow-lan':False,'bind-address':'127.0.0.1','log-level':'error'})
config.pop('external-controller',None)
if isinstance(config.get('dns'),dict): config['dns']['listen']='127.0.0.1:17853'
(proxy/'config.yaml').write_text(yaml.safe_dump(config,allow_unicode=True))
unit=home/'.config/systemd/user/yahoo-session-proxy.service'
unit.write_text('''[Unit]
Description=Local proxy for goods hunter Yahoo session
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/.local/share/goods-hunter/yahoo-proxy
ExecStart=%h/.local/share/goods-hunter/yahoo-proxy/mihomo -d %h/.local/share/goods-hunter/yahoo-proxy -f %h/.local/share/goods-hunter/yahoo-proxy/config.yaml
Restart=on-failure
RestartSec=10
UMask=0077
MemoryMax=192M
StandardOutput=null
StandardError=null
''')
service=home/'.config/systemd/user/yahoo-session.service'
service.write_text(service.read_text().replace('After=network-online.target','After=network-online.target yahoo-session-proxy.service\nRequires=yahoo-session-proxy.service'))
environment=home/'.config/goods-hunter/yahoo-session.env'
environment.write_text(environment.read_text()+'YAHOO_BROWSER_PROXY=http://127.0.0.1:17890\n')
for path in [proxy,unit,service,environment,*proxy.iterdir()]:
 os.chown(path,user.pw_uid,user.pw_gid)
 if path.is_file() and path.name!='mihomo': path.chmod(0o600)
subprocess.check_call(['loginctl','enable-linger','wangming'])
subprocess.check_call(['systemctl','start','user@1000.service'])
command=['runuser','-u','wangming','--','env','XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus','systemctl','--user']
subprocess.check_call(command+['daemon-reload'])
subprocess.check_call(command+['start','yahoo-session-proxy.service'])
(root/'prepared.json').write_text(json.dumps({'sidecarInstalled':True,'proxyInstalled':True,'applicationActivated':False,'stateDirectory':str(home/'.local/share/goods-hunter/yahoo-session'),'expected':json.loads((root/'expected.json').read_text())}))
print('Private loopback proxy configured using existing FC proxy settings; timer remains inactive.')
