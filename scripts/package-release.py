"""Package Codex and DSH plugins with optional built probes."""

import argparse
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--plugins-only', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
dist = root / 'dist' / f'v{version}'
dist.mkdir(parents=True, exist_ok=True)

codex = root / 'plugins/minecraft-mod-dev'
if not (codex / 'server.cjs').is_file():
    raise RuntimeError('Run npm run build before packaging')
with zipfile.ZipFile(dist / f'minecraft-mod-dev-codex-{version}.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    prefix = 'minecraft-mod-dev-codex/'
    archive.write(root / '.agents/plugins/marketplace.json', prefix + '.agents/plugins/marketplace.json')
    for path in sorted(codex.rglob('*')):
        if path.is_file():
            archive.write(path, prefix + 'plugins/minecraft-mod-dev/' + path.relative_to(codex).as_posix())

dsh = root / 'plugin/minecraft-mod-dev'
package = json.loads((dsh / 'package.json').read_text())
assert package['version'] == version, 'DSH version differs from workspace'
files = {'package.json', 'PLUGIN-NOTES.md'}
for pattern in package['files']:
    files.update(path.relative_to(dsh).as_posix() for path in dsh.glob(pattern) if path.is_file())
with zipfile.ZipFile(dist / f'minecraft-mod-dev-{version}.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(files):
        archive.write(dsh / name, 'minecraft-mod-dev/' + name)
    archive.write(root / 'LICENSE', 'minecraft-mod-dev/LICENSE')
    archive.write(root / 'docs/MINECRAFT-26.1.2.md', 'minecraft-mod-dev/MINECRAFT-26.1.2.md')

if not args.plugins_only:
    for loader in ['forge', 'neoforge']:
        name = f'mcdev_probe-{loader}-26.1.2-0.2.0.jar'
        shutil.copyfile(root / f'lab/mcdev-probe-{loader}-26.1.2/build/libs/{name}', dist / name)

artifacts = sorted(path for path in dist.iterdir() if path.suffix in {'.zip', '.jar'})
(dist / 'SHA256SUMS.txt').write_text(''.join(
    f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in artifacts
), encoding='utf-8')
for path in artifacts:
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, path.name
    print(path.name, path.stat().st_size)
