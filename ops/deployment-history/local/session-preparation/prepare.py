from pathlib import Path
import hashlib, json, os, pwd, shutil, subprocess, tarfile

root = Path('/home/wangming/project/.goods_hunter-deployments/yahoo-session-20261029-01')
app = Path('/home/wangming/project/goods_hunter')
user = pwd.getpwnam('wangming')
os.umask(0o077)
expected = json.loads((root / 'expected.json').read_text())
changed = [name for name, digest in expected.items() if hashlib.sha256((app / name).read_bytes()).hexdigest() != digest]
if changed:
    raise RuntimeError('Application changed since deployment baseline: ' + repr(changed))
stage = root / 'stage'
stage.mkdir(exist_ok=True)
with tarfile.open(root / 'release.tar.gz') as archive:
    for member in archive.getmembers():
        assert not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
    archive.extractall(stage)
with tarfile.open(root / 'before.tar.gz', 'w:gz') as archive:
    for name in expected:
        archive.add(app / name, arcname=name)
target = app / 'tools/yahoo-session'
if target.exists():
    raise RuntimeError('Session tool directory already exists; refusing overwrite')
target.parent.mkdir(exist_ok=True)
shutil.copytree(stage / 'tools/yahoo-session', target)
runtime = Path(user.pw_dir) / '.local/share/goods-hunter/runtime'
runtime.mkdir(parents=True, exist_ok=True)
if (runtime / 'python').exists():
    raise RuntimeError('Independent Python already exists; refusing overwrite')
with tarfile.open(root / 'runtime.tar.gz') as archive:
    archive.extractall(runtime)
subprocess.check_call([str(runtime / 'python/bin/python3'), '-m', 'venv', '--without-pip', str(target / '.venv')])
destination = target / '.venv/lib/python3.12/site-packages'
for source in (runtime / 'site-packages').iterdir():
    dest = destination / source.name
    if source.is_dir(): shutil.copytree(source, dest)
    else: shutil.copy2(source, dest)
shutil.rmtree(runtime / 'site-packages')
state = Path(user.pw_dir) / '.local/share/goods-hunter/yahoo-session'
state.mkdir(parents=True, exist_ok=True, mode=0o700)
config = Path(user.pw_dir) / '.config/goods-hunter'
units = Path(user.pw_dir) / '.config/systemd/user'
config.mkdir(parents=True, exist_ok=True)
units.mkdir(parents=True, exist_ok=True)
env = config / 'yahoo-session.env'
if env.exists(): raise RuntimeError('Session environment already exists; refusing overwrite')
env.write_text('YAHOO_SESSION_DIR=' + str(state) + '\nYAHOO_BROWSER_CHANNEL=chrome\n')
env.chmod(0o600)
for name in ('yahoo-session.service', 'yahoo-session.timer'):
    if (units / name).exists(): raise RuntimeError('Unit already exists: ' + name)
    shutil.copy2(target / name, units / name)
unit = units / 'yahoo-session.service'
unit.write_text(unit.read_text().replace('UMask=0077', 'UMask=0077\nMemoryMax=512M'))
for base in (target, runtime, state, config, units):
    for directory, dirs, files in os.walk(base):
        os.chown(directory, user.pw_uid, user.pw_gid)
        for name in dirs + files: os.chown(os.path.join(directory, name), user.pw_uid, user.pw_gid, follow_symlinks=False)
for base in (target.parent, runtime.parent, runtime.parent.parent, runtime.parent.parent.parent, config.parent, units.parent):
    os.chown(base, user.pw_uid, user.pw_gid)
subprocess.check_call(['runuser', '-u', 'wangming', '--', str(target / '.venv/bin/python'), str(target / 'session_manager.py'), 'status', '--state-dir', str(state)])
(root / 'prepared.json').write_text(json.dumps({'sidecarInstalled': True, 'applicationActivated': False, 'stateDirectory': str(state), 'expected': expected}))
print('Session tools, independent Python and inactive timer installed. Application files remain staged.', flush=True)
