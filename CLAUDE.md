# 반반 BanBan（spilt.chung.men）

繁體中文、台灣用語、可愛韓系風。分帳 PWA（Vite + React + TS）＋ `server/`（Hono + node:sqlite）。完整脈絡見 `docs/ROADMAP.md`、`README.md`。

## 正式機（這台 VPS）

- 站台根目錄就是這個 git checkout（opc 擁有）；nginx 執行目錄 `dist/`（寶塔 SetSiteRunPath）。
- 後端：PM2 `banban`（`deploy/ecosystem.config.cjs`，Node 24 於 `~/.local/node24`），`127.0.0.1:3456`，`DATA_DIR=/www/banban-data`。
- nginx：寶塔反代 `/api/` → 3456（`vhost/nginx/proxy/spilt.chung.men/`）；自訂設定在 `vhost/nginx/extension/spilt.chung.men/`：HTTPS 轉址（配合 Cloudflare Flexible）、PWA MIME、`/s/` try_files。
- 憑證：寶塔 Let's Encrypt，自動續。Cloudflare 橘雲，zone 是 Flexible SSL（CF 走 80 連原站），所以**不要**開寶塔的「強制 HTTPS」。
- 機密在 `/www/banban-data/.env`（`ADMIN_TOKEN`），ecosystem 讀進環境變數。統計：`curl -H "Authorization: Bearer $ADMIN_TOKEN" https://spilt.chung.men/api/admin/stats`。
- 多用戶：任何人開同步就自動建帳號（每 IP 每小時最多 10 個新帳號），180 天沒同步的帳號連資料一起刪（`INACTIVE_DAYS`）。
- 分享頁 `/s/<id>` 由 nginx 反代到 Node（`app.get('/s/:id')` 讀 `dist/s/index.html` 注入 OG）；預覽圖 `server/src/og.ts`（sharp + SVG），中文字型 `/www/banban-data/fonts/NotoSansTC-Bold.otf`，ecosystem 設 `FONTCONFIG_FILE`。
- BYOK：使用者自帶金鑰存 `AppData.aiProvider`（E2E 加密同步）；`src/lib/receiptAi.ts` 是前後端共用的 provider 呼叫（openai／anthropic 兩種格式）；瀏覽器直打失敗（TypeError=CORS）才走 `POST /api/parse/byok`（需同步帳號、每 IP 60/時、只准 https 公網、金鑰不落地不記 log）。
- AI 辨識：`MINIMAX_*` 在 `/www/banban-data/.env`（與 thin/tarot 同一把），`server/src/ai.ts`。**存取控管**：帳號要先用 `AI_INVITE_CODE`（.env）在設定頁開通，或站長用 admin API 開；每帳號每日 `AI_DAILY_QUOTA`（40）、全站每日 `AI_GLOBAL_DAILY`（300），用量存 `ai_usage` 表。`AI_OPEN=1` 才會對所有人開放。
  - 看誰在用：`curl -H "Authorization: Bearer $ADMIN_TOKEN" https://spilt.chung.men/api/admin/ai`
  - 開通／停用：`curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"accountId":"<id>","allow":true,"note":"朋友"}' https://spilt.chung.men/api/admin/ai`
- 推播：VAPID 金鑰也在 `/www/banban-data/.env`；SW 是 `src/sw.ts`（injectManifest，被 tsconfig exclude，靠 vite build 編譯）。
- 更新：`deploy/update.sh`。備份：`deploy/backup-db.sh`（cron 04:15，`/www/my_www_backup/banban/`）。
- 寶塔會把 immutable 的 `.user.ini` 丟進 `dist/`，Vite 清 dist 會失敗；update.sh 已處理。

## 開發約定

- 拆帳邏輯只在 `src/lib/split.ts`，前後端共用型別在 `src/lib/types.ts`。
- 資料改動一律走 `useStore.update / updateProject`（會 bump `updatedAt`、標 dirty、2.5 秒後自動同步）。只改 metadata 不想動 `updatedAt` 時用 `updateProject(id, fn, false)`。
- 同步與分享的所有加密都在前端（`src/lib/sync.ts`、`src/lib/share.ts`），後端只碰密文。改 API 記得同步更新 `server/src/app.test.ts`。
- `npm test` 會一起跑後端測試；`npm run build` 前跑 `tsc --noEmit`，後端另有 `cd server && npm run typecheck`。
- 旅程共編：`src/lib/tripSync.ts` + store 的 shareTrip/joinTrip/syncTrip；伺服器 `/api/trip*` 不綁帳號，token 由旅程金鑰派生。測試 `src/test/tripShare.dom.test.tsx` 用假伺服器模擬兩台裝置，改共編邏輯一定要跑。
- 分享頁是獨立入口 `s/index.html` → `src/share/`，不要 import zustand store。OG 標題（`share.ogTitle`）是分享唯一的明文，絕不放金額。
