#!/bin/bash
# spilt.chung.men 更新：拉最新 main → 前後端安裝相依 → 測試 → build 到 dist/ → 重啟後端
set -euo pipefail
cd /www/wwwroot/spilt.chung.men
git pull --ff-only origin main
npm ci --no-audit --no-fund
(cd server && npm ci --no-audit --no-fund --omit=dev)
npm test
# 寶塔會把 .user.ini（immutable）丟進執行目錄 dist/，Vite 清空 dist 時會被擋
if [ -e dist/.user.ini ]; then sudo chattr -i dist/.user.ini; sudo rm -f dist/.user.ini; fi
# 憑證更新會在 dist/ 留下 root 擁有的 .well-known，Vite 清不掉會中止；建置前移開，結束時（成功或失敗）放回
WK_HOLD=""
if [ -e dist/.well-known ]; then WK_HOLD=$(mktemp -d /tmp/spilt-wk.XXXXXX); sudo mv dist/.well-known "$WK_HOLD/"; fi
restore_wk() {
  if [ -n "$WK_HOLD" ] && [ -e "$WK_HOLD/.well-known" ]; then
    mkdir -p dist; sudo rm -rf dist/.well-known; sudo mv "$WK_HOLD/.well-known" dist/; rmdir "$WK_HOLD" 2>/dev/null || true
  fi
}
trap restore_wk EXIT
npm run build
pm2 restart banban --update-env
echo "done: $(git log -1 --format='%h %s')"
