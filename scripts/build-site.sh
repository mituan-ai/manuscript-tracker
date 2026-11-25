#!/usr/bin/env bash
# 生成官网静态文件到 dist/site/：页面、扩展的基础样式和 logo。扩展只从浏览器的扩展商店安装，网站不提供 zip 下载。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/manifest.json').version")"
# 两个商店的扩展 ID。生成时会查询商店：还没上架的，页面上显示“审核中”，不放打不开的链接；上架后重新生成一次就换成安装按钮。
EDGE_ID="hkljgniplahnifceaoaehfkefbcilmpd"
CHROME_ID="cgegoafnapldoacegnnapjbhpfnmjijo"
probe() { curl -sL --max-time 20 -o /dev/null "$@" || { echo "查询扩展商店失败，检查网络后重试" >&2; return 1; }; }
EDGE_URL="" CHROME_URL=""
# Edge：已上架的扩展，这个接口返回 200 和详情；没上架的返回 404
EDGE_CODE="$(probe -w '%{http_code}' "https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/$EDGE_ID")"
[ "$EDGE_CODE" = 200 ] && EDGE_URL="https://microsoftedge.microsoft.com/addons/detail/$EDGE_ID"
# Chrome：已上架的详情页会跳转到 /detail/<名称>/<ID>，没上架的跳到 /detail/empty-title/<ID>
CHROME_FINAL="$(probe -w '%{url_effective}' "https://chromewebstore.google.com/detail/$CHROME_ID")"
case "$CHROME_FINAL" in
  */detail/empty-title/*) ;;
  *) CHROME_URL="https://chromewebstore.google.com/detail/$CHROME_ID" ;;
esac
echo "Edge 加载项：${EDGE_URL:-审核中}"
echo "Chrome 应用商店：${CHROME_URL:-审核中}"
OUT="$ROOT/dist/site"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$ROOT/site/." "$OUT/"
cp "$ROOT/ui/style.css" "$OUT/base.css"
cp "$ROOT/ui/theme.js" "$OUT/theme.js"
# base.css 里的 @font-face 用相对路径 fonts/，字体放在站点根目录的 fonts/ 下
cp -r "$ROOT/ui/fonts" "$OUT/fonts"
cp "$ROOT/ui/logo.svg" "$OUT/logo.svg"
cp "$ROOT/icons/128.png" "$OUT/icon-128.png"
sed -i -e "s|__VERSION__|$VERSION|g" -e "s|__EDGE_URL__|$EDGE_URL|g" -e "s|__CHROME_URL__|$CHROME_URL|g" "$OUT/index.html"
echo "官网已生成：$OUT（扩展 v$VERSION）"
