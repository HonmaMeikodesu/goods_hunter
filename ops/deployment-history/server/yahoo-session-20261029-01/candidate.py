from pathlib import Path
import json, shutil, tarfile
root=Path('/home/wangming/project/.goods_hunter-deployments/yahoo-session-20261029-01')
app=Path('/home/wangming/project/goods_hunter')
candidate=root/'candidate'
candidate.mkdir(mode=0o700,exist_ok=True)
shutil.copytree(app/'dist',candidate/'dist',ignore=shutil.ignore_patterns('private'))
(candidate/'node_modules').symlink_to(app/'node_modules',target_is_directory=True)
with tarfile.open(root/'compiled.tar.gz') as archive: archive.extractall(candidate)
print('Prepared isolated candidate; running application is unchanged.')
