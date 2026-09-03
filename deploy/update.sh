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
npm run build
pm2 restart banban --update-env
echo "done: $(git log -1 --format='%h %s')"
