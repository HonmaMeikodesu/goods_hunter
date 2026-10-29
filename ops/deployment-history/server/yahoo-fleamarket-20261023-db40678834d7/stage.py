from pathlib import Path
import json,tarfile,shutil,os
root=Path('/home/wangming/project/.goods_hunter-deployments/yahoo-fleamarket-20261023-db40678834d7')
app=Path('/home/wangming/project/goods_hunter')
stage=root/'stage'
stage.mkdir(mode=0o700)
manifest=json.loads((root/'app-manifest.json').read_text())
with tarfile.open(root/'app-release.tar.gz') as archive:
 for member in archive.getmembers():
  assert member.isfile() and member.name in manifest and not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
 archive.extractall(stage)
(stage/'node_modules').symlink_to(app/'node_modules',target_is_directory=True)
for prefix in ('src/private','dist/private'):
 target=stage/prefix;target.mkdir(parents=True,exist_ok=True)
 for name in ('alicloud.json','email.json','secret.json','server.json','yahoo.json'):
  source=app/prefix/name
  if source.is_file():shutil.copy2(source,target/name)
print('Staged',len(manifest),'deployment files without changing live service')
