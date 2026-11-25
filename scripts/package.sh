#!/usr/bin/env bash
# 把扩展打包成上传到 Edge 加载项和 Chrome 应用商店的 dist/manuscript-tracker-<版本>.zip。
# 商店不接受 manifest.json 里的 "key"（各商店自己分配扩展 ID），所以打包时去掉它。
# 仓库里保留 "key"，只是为了开发时 npm run deploy 加载的扩展 ID 固定（dohmncmimffpejlgnfellofohdnngppm）。
# 用法：bash scripts/package.sh      输出 zip 的路径
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/manifest.json').version")"
OUT="$ROOT/dist/manuscript-tracker-$VERSION.zip"
mkdir -p "$ROOT/dist"
python3 -I - "$ROOT" "$OUT" <<'PY'
import json, os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
include = ['manifest.json', 'background.js', 'offscreen.html', 'offscreen.js', 'LICENSE', 'README.md',
           '_locales', 'adapters', 'content', 'lib', 'ui', 'icons']
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in include:
        path = os.path.join(root, name)
        files = [path] if os.path.isfile(path) else [os.path.join(d, f) for d, _, fs in os.walk(path) for f in fs]
        for f in sorted(files):
            rel = os.path.relpath(f, root)
            if rel == 'manifest.json':
                with open(f, encoding='utf-8') as fh:
                    manifest = json.load(fh)
                manifest.pop('key', None)
                z.writestr(rel, json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
            else:
                z.write(f, rel)
print(out)
PY
