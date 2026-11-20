#!/usr/bin/env bash
# 把官网发布到服务器（默认 dmit:/var/www/manuscript-tracker）。先上传到 .new 目录，再整体替换，不保留旧版本（需要回滚时用 git 里的旧版本重新发布）。
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
  rm -rf '$DIR.old'
  if [ -d '$DIR' ]; then mv '$DIR' '$DIR.old'; fi
  mv '$DIR.new' '$DIR'
  rm -rf '$DIR.old'"
echo "已发布到 $HOST:$DIR"
