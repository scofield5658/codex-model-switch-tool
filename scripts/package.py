from pathlib import Path
import shutil,json,zipfile
from importlib.metadata import distribution
root=Path(__file__).resolve().parent.parent
release=root/'release';market=release/'local-marketplace';target=market/'plugins/codex-model-switch-tool'
if target.exists(): shutil.rmtree(target)
target.mkdir(parents=True)
for filename in ['plugin.json','mcp.json','.mcp.json','README.md','LICENSE','pyproject.toml','uv.lock','.python-version']:
    shutil.copy2(root/filename,target/filename)
for directory in ['.codex-plugin','assets','backend','locales']:
    shutil.copytree(root/directory,target/directory,ignore=shutil.ignore_patterns('__pycache__','*.pyc','vendor'))
(target/'dist').mkdir()
for file in ['server.cjs','setup-runtime.cjs','ui.html']:
    shutil.copy2(root/'dist'/file,target/'dist'/file)
for file in (root/'dist').glob('*.LEGAL.txt'): shutil.copy2(file,target/'dist'/file.name)
(target/'docs').mkdir()
for file in ['python-runtime.md','i18n-assessment.md']:
    shutil.copy2(root/'docs'/file,target/'docs'/file)
(target/'docs/images').mkdir()
for file in ['provider-settings.png','codex-model-picker.png']:
    shutil.copy2(root/'docs/images'/file,target/'docs/images'/file)
# Include dependency notices even though Python packages are now installed by uv.
licenses=target/'licenses';licenses.mkdir()
tomlkit=distribution('tomlkit')
license_file=next(file for file in tomlkit.files if file.name=='LICENSE')
shutil.copy2(tomlkit.locate_file(license_file),licenses/'tomlkit-LICENSE')
for file in (root/'node_modules').rglob('LICENSE*'):
    if file.is_file() and file.stat().st_size<200000:
        name=str(file.relative_to(root/'node_modules')).replace('/','_')
        shutil.copy2(file,licenses/name)
manifest={'name':'model-switch-plugin','interface':{'displayName':'本地模型工具'},'plugins':[{'name':'codex-model-switch-tool','source':{'source':'local','path':'./plugins/codex-model-switch-tool'},'policy':{'installation':'AVAILABLE','authentication':'ON_INSTALL'},'category':'Developer Tools'}]}
mp=market/'.agents/plugins';mp.mkdir(parents=True,exist_ok=True);(mp/'marketplace.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
version=json.loads((root/'plugin.json').read_text(encoding='utf-8'))['version']
archive=release/('codex-model-switch-tool-'+version+'.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for file in target.rglob('*'):
        if file.is_file():
            assert not file.is_symlink()
            z.write(file,Path('codex-model-switch-tool')/file.relative_to(target))
print('Packaged:',archive)
print('Marketplace:',market)
