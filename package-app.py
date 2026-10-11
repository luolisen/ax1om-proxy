#!/usr/bin/env python3
"""Build the standalone app bundle without changing any running proxy."""
from pathlib import Path
import plistlib, shutil, subprocess

root = Path(__file__).resolve().parent
subprocess.run(['python3', str(root / 'scripts/fetch-runtime.py')], check=True)
subprocess.run(['swift', 'build', '-c', 'release'], cwd=root, check=True)
binary_dir = Path(subprocess.check_output(['swift', 'build', '-c', 'release', '--show-bin-path'], cwd=root, text=True).strip())
destination = root / 'dist' / 'AX1OM Network.app'
if destination.exists():
    marker = destination / 'Contents' / 'Info.plist'
    if not marker.exists() or plistlib.loads(marker.read_bytes()).get('CFBundleIdentifier') != 'kg.alan.ax1om.native':
        raise RuntimeError('Refusing to overwrite an unrelated app')
    shutil.rmtree(destination)
(destination / 'Contents/MacOS').mkdir(parents=True)
(destination / 'Contents/Resources').mkdir()
shutil.copy2(binary_dir / 'AX1OM', destination / 'Contents/MacOS/AX1OM')
shutil.copytree(binary_dir / 'AX1OM_AX1OM.bundle', destination / 'Contents/Resources/AX1OM_AX1OM.bundle')
resources = destination / 'Contents/Resources'
shutil.copytree(root / 'vendor-runtime/bin', resources / 'bin')
shutil.copy2(root / 'vendor-runtime/runtime-manifest.json', resources / 'runtime-manifest.json')
(resources / 'Licenses').mkdir()
shutil.copy2(root / 'vendor-runtime/NODE-LICENSE', resources / 'Licenses/NODE-LICENSE')
shutil.copy2(root / 'vendor-runtime/MIHOMO-LICENSE', resources / 'Licenses/MIHOMO-LICENSE')
for name in ['LICENSE', 'NOTICE.md']:
    if (root / name).exists(): shutil.copy2(root / name, resources / 'Licenses' / name)
clang = Path(subprocess.check_output(['xcrun', '--find', 'clang'], text=True).strip())
xcode_clang = Path('/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang')
sdk = subprocess.check_output(['xcrun', '--show-sdk-path'], text=True).strip()
if xcode_clang.exists():
    clang = xcode_clang
    sdk = '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk'
subprocess.run([str(clang), '-isysroot', sdk, '-mmacosx-version-min=14.0', '-Wno-deprecated-declarations', str(root / 'Support/PrivilegedLauncher.c'), '-framework', 'Security', '-o', str(resources / 'bin/ax1om-privileged-launcher')], check=True)

iconset = root / '.build' / 'AppIcon.iconset'
subprocess.run(['swift', str(root / 'render-app-icon.swift'), str(root / 'Sources/AX1OM/Resources/ax1om-monogram.png'), str(iconset)], check=True)
subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o', str(destination / 'Contents/Resources/AppIcon.icns')], check=True)
info = {'CFBundleIdentifier': 'kg.alan.ax1om.native', 'CFBundleName': 'AX1OM Network', 'CFBundleDisplayName': 'AX1OM Network',
        'CFBundleExecutable': 'AX1OM', 'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': '0.1.0',
        'CFBundleVersion': '1', 'LSMinimumSystemVersion': '14.0', 'NSHighResolutionCapable': True,
        'LSApplicationCategoryType': 'public.app-category.utilities', 'CFBundleIconFile': 'AppIcon'}
(destination / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
subprocess.run(['/usr/bin/codesign', '--force', '--deep', '--sign', '-', str(destination)], check=True)
print(destination)
