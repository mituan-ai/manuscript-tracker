#!/usr/bin/env bash
# 把扩展打包成 dist/manuscript-tracker-<版本>.zip。文件直接放在 zip 根目录（不再套一层文件夹）：
# Windows「全部解压缩」、WinRAR / 360 压缩的「解压到 manuscript-tracker\」都会得到一个同名文件夹，
# 里面直接就是 manifest.json，用户在扩展管理页「加载解压缩的扩展」选这个文件夹即可，不会选错层。
#
# manifest.json 里的 "key" 固定了手动安装时的扩展 ID（与文件夹位置无关），更新时账号和记录才能保留。
# 扩展商店不接受带 "key" 的包（Edge 加载项会报 "The manifest shouldn't contain the key field"），
# 商店会自己分配 ID，所以 --store 打出的包去掉这个字段：dist/manuscript-tracker-<版本>-store.zip。
# 用法：bash scripts/package.sh [--store]      输出 zip 的路径
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/manifest.json').version")"
STORE=0 SUFFIX=""
if [ "${1:-}" = "--store" ]; then STORE=1 SUFFIX="-store"; fi
OUT="$ROOT/dist/manuscript-tracker-$VERSION$SUFFIX.zip"
mkdir -p "$ROOT/dist"
python3 -I - "$ROOT" "$OUT" "$STORE" <<'PY'
import json, os, sys, zipfile
root, out, store = sys.argv[1], sys.argv[2], sys.argv[3] == '1'
include = ['manifest.json', 'background.js', 'offscreen.html', 'offscreen.js', 'LICENSE', 'README.md',
           '_locales', 'adapters', 'content', 'lib', 'ui', 'icons']
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in include:
        path = os.path.join(root, name)
        files = [path] if os.path.isfile(path) else [os.path.join(d, f) for d, _, fs in os.walk(path) for f in fs]
        for f in sorted(files):
            rel = os.path.relpath(f, root)
            if store and rel == 'manifest.json':
                with open(f, encoding='utf-8') as fh:
                    manifest = json.load(fh)
                manifest.pop('key', None)
                z.writestr(rel, json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
            else:
                z.write(f, rel)
print(out)
PY
