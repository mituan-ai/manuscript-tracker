#!/usr/bin/env bash
# 生成官网静态文件到 dist/site/：页面、扩展的基础样式和 logo、可下载的扩展 zip。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/manifest.json').version")"
OUT="$ROOT/dist/site"
rm -rf "$OUT"
mkdir -p "$OUT/download"
cp -r "$ROOT/site/." "$OUT/"
cp "$ROOT/ui/style.css" "$OUT/base.css"
cp "$ROOT/ui/theme.js" "$OUT/theme.js"
# base.css 里的 @font-face 用相对路径 fonts/，字体放在站点根目录的 fonts/ 下
cp -r "$ROOT/ui/fonts" "$OUT/fonts"
cp "$ROOT/ui/logo.svg" "$OUT/logo.svg"
cp "$ROOT/icons/128.png" "$OUT/icon-128.png"
ZIP="$(bash "$ROOT/scripts/package.sh")"
SIZE_KB="$(( ($(stat -c %s "$ZIP") + 1023) / 1024 ))"
sed -i -e "s/__VERSION__/$VERSION/g" -e "s/__SIZE_KB__/$SIZE_KB/g" "$OUT/index.html"
# 下载文件不带版本号：解压出来的文件夹总叫 manuscript-tracker，更新时解压到原位置覆盖即可。
# manuscript-tracker-latest.zip 是旧链接，保留同样的内容。
cp "$ZIP" "$OUT/download/manuscript-tracker.zip"
cp "$ZIP" "$OUT/download/manuscript-tracker-latest.zip"
echo "官网已生成：$OUT（扩展 v$VERSION）"
