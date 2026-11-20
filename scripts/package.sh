#!/usr/bin/env bash
# 把扩展打包成 dist/manuscript-tracker-<版本>.zip。文件直接放在 zip 根目录（不再套一层文件夹）：
# Windows「全部解压缩」、WinRAR / 360 压缩的「解压到 manuscript-tracker\」都会得到一个同名文件夹，
# 里面直接就是 manifest.json，用户在扩展管理页「加载解压缩的扩展」选这个文件夹即可，不会选错层。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/manifest.json').version")"
OUT="$ROOT/dist/manuscript-tracker-$VERSION.zip"
mkdir -p "$ROOT/dist"
python3 -I - "$ROOT" "$OUT" <<'PY'
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
include = ['manifest.json', 'background.js', 'offscreen.html', 'offscreen.js', 'LICENSE', 'README.md',
           '_locales', 'adapters', 'content', 'lib', 'ui', 'icons']
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in include:
        path = os.path.join(root, name)
        files = [path] if os.path.isfile(path) else [os.path.join(d, f) for d, _, fs in os.walk(path) for f in fs]
        for f in sorted(files):
            z.write(f, os.path.relpath(f, root))
print(out)
PY
