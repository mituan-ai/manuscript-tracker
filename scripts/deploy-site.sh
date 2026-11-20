#!/usr/bin/env bash
# 把官网发布到服务器（默认 dmit:/var/www/manuscript-tracker）。先上传到 .new 目录，再整体替换，旧版本留在 .old 便于回滚。
# 首次部署前要先配好域名、证书和 nginx，见 deploy/README.md。
# 用法：npm run deploy:site                      SITE_HOST / SITE_DIR 可用环境变量覆盖
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${SITE_HOST:-dmit}"
DIR="${SITE_DIR:-/var/www/manuscript-tracker}"
bash "$ROOT/scripts/build-site.sh"
tar czf - -C "$ROOT/dist/site" . | ssh "$HOST" "set -e
  rm -rf '$DIR.new' && mkdir -p '$DIR.new' && tar xzf - -C '$DIR.new'
  chmod -R a+rX '$DIR.new'
  if [ -d '$DIR' ]; then rm -rf '$DIR.old' && mv '$DIR' '$DIR.old'; fi
  mv '$DIR.new' '$DIR'"
echo "已发布到 $HOST:$DIR"
