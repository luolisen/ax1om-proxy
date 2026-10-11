#!/usr/bin/env python3
"""Fetch pinned official Apple Silicon runtimes and verify archives before unpacking."""
from pathlib import Path
import gzip, hashlib, json, os, platform, shutil, tarfile, urllib.request
ROOT = Path(__file__).resolve().parent.parent
MANIFEST = {
    'node': {'version': 'v26.9.0', 'url': 'https://nodejs.org/dist/v26.9.0/node-v26.9.0-darwin-arm64.tar.gz', 'sha256': '6f3de7ed853ee283b4bf24b6e426618f1d357401ce5815db1866eb85eb4b05d9'},
    'mihomo': {'version': 'v1.19.32', 'url': 'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.32/mihomo-darwin-arm64-v1.19.32.gz', 'sha256': '3312a6780652c622890fd4357c6a853bbf865464fd047ac7b7f52dab8de18652'}
}

def main():
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise RuntimeError('v0.1.0 runtime package supports Apple Silicon macOS only')
    target = ROOT / 'vendor-runtime'
    (target / 'bin').mkdir(parents=True, exist_ok=True)
    for name, entry in MANIFEST.items():
        archive = target / ('node.tar.gz' if name == 'node' else 'mihomo.gz')
        if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != entry['sha256']:
            temporary = archive.with_suffix('.download')
            request = urllib.request.Request(entry['url'], headers={'User-Agent': 'AX1OM-Network-build/0.1'})
            with urllib.request.urlopen(request, timeout=90) as response, temporary.open('wb') as output:
                shutil.copyfileobj(response, output)
            if hashlib.sha256(temporary.read_bytes()).hexdigest() != entry['sha256']:
                temporary.unlink()
                raise RuntimeError(f'{name} checksum mismatch')
            temporary.replace(archive)
        if name == 'node':
            with tarfile.open(archive, 'r:gz') as tar:
                prefix = 'node-v26.9.0-darwin-arm64/'
                for member, destination in [('bin/node', target / 'bin/node'), ('LICENSE', target / 'NODE-LICENSE')]:
                    staged = destination.with_name(destination.name + '.staged')
                    with tar.extractfile(prefix + member) as source, staged.open('wb') as output:
                        shutil.copyfileobj(source, output)
                    os.replace(staged, destination)
        else:
            staged = target / 'bin/mihomo.staged'
            with gzip.open(archive, 'rb') as source, staged.open('wb') as output:
                shutil.copyfileobj(source, output)
            os.replace(staged, target / 'bin/mihomo')
        os.chmod(target / 'bin' / name, 0o755)
    license_url = 'https://raw.githubusercontent.com/MetaCubeX/mihomo/v1.19.32/LICENSE'
    with urllib.request.urlopen(license_url, timeout=30) as response:
        (target / 'MIHOMO-LICENSE').write_bytes(response.read())
    (target / 'runtime-manifest.json').write_text(json.dumps(MANIFEST, indent=2) + '\n')
    print('Pinned runtimes verified and ready.')

if __name__ == '__main__':
    main()
