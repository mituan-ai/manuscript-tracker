#!/usr/bin/env bash
# 把扩展复制到 Windows 目录，供 Edge / Chrome「加载解压缩的扩展」使用（WSL 下运行）。
# 用法：npm run deploy            → 复制到 %USERPROFILE%\Extensions\submission-tracker
#       npm run deploy -- <目录>  → 复制到指定目录
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
if [ $# -ge 1 ]; then
  DEST="$1"
else
  WINHOME="$(wslpath "$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')")"
  DEST="$WINHOME/Extensions/submission-tracker"
fi
mkdir -p "$DEST"
rsync -a --delete \
  --exclude node_modules --exclude test --exclude scripts \
  --exclude 'package*.json' --exclude .gitignore --exclude README.md --exclude site --exclude dist --exclude deploy \
  "$SRC/" "$DEST/"
echo "已复制到：$(wslpath -w "$DEST" 2>/dev/null || echo "$DEST")"
echo "首次安装：打开 edge://extensions → 打开「开发人员模式」→「加载解压缩的扩展」→ 选择上面的目录"
echo "之后更新：再运行一次本命令，然后在 edge://extensions 里点这个扩展的「重新加载」"
