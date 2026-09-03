# 반반 BanBan 開發路線圖

> 目前版本：部署在 VPS `https://spilt.chung.men`（是 spilt 不是 split，將錯就錯）。
> 第一階段（`server/` 後端、端對端加密同步、分享連結與「我轉了」）已於 2026-09-03 完成上線。
> 下一步：第二階段通知與排程。

## 程式碼地圖（現況）

| 路徑 | 內容 |
| --- | --- |
| `src/lib/split.ts` | 拆帳引擎：`computeSplit()`、四捨五入修正、分享文字。後端可直接 import。 |
| `src/lib/einvoice.ts` | 台灣電子發票 QR 解析（左右兩顆、Big5/UTF-8/Base64）。 |
| `src/lib/receiptText.ts` | OCR / 貼上文字的品項解析。 |
| `src/lib/rates.ts` | 匯率抓取（currency-api，依日期）。 |
| `src/lib/crypto.ts` | PIN → PBKDF2 → AES-GCM 加密。 |
| `src/lib/storage.ts` | IndexedDB 存取、上鎖狀態。 |
| `src/lib/types.ts` | 資料模型：`Project`、`Item`、`Extra`、`Person`。 |
| `src/store.ts` | zustand 狀態與所有寫入動作。 |
| `src/pages/*` | 首頁、帳本頁、設定頁、鎖定畫面。 |
| `src/components/ImportSheet.tsx` | QR 掃描、拍照 OCR、貼上文字、確認明細。 |
| `.github/workflows/deploy.yml` | GitHub Pages 部署。 |

## VPS 環境

- Red Hat Enterprise 9.8 aarch64，面板式主機（Node 專案 = PM2 + Nginx 反向代理）。
- Node 20（可跑；日後升 22/24 LTS 只要在面板切版本）。
- 後端語言選 **Node**：與前端共用 TypeScript 與拆帳邏輯，單一 repo、單一部署流程。

## 第一階段：`server/` 基礎後端 ✅（2026-09-03 完成）

目標：多裝置同步 + 朋友的分享連結，資料維持端對端加密。

### 實作結果（與原計畫的差異）

- 後端：Hono + `@hono/node-server`，資料庫用 **Node 24 內建 `node:sqlite`**（不是 better-sqlite3，省掉 ARM 原生模組編譯與 Node 版本綁定）。TypeScript 直接由 Node 執行（type stripping），沒有 build 步驟。程式在 `server/src/{app,db,index}.ts`，測試 `server/src/app.test.ts`。
- 身分與金鑰：一把 32 bytes 隨機 secret（顯示為 `bb1.<base64url>`），HKDF 派生出 **auth token**（伺服器只存 SHA-256）與 **AES-GCM 金鑰**（永不離開裝置）。有沒有設 PIN 都能同步；PIN 仍只管裝置上的加密。secret 存在 AppData 裡（設 PIN 就跟著加密）。
- 合併：`mergeData()` 無需 base 的三方合併：帳本以 `updatedAt` 後者為準、刪除用墓碑（`deleted`）、朋友取聯集、純量欄位跟較新的那份。衝突（409）自動重拉重合併再推，最多 4 次。以 `canon()` 比對內容避免兩台裝置互推版本號。
- 分享：`/s/<id>#<key>` 靜態頁（`s/index.html` → `src/share/`），key 只在 fragment。快照在同步時若過期於帳本 `updatedAt` 會自動重傳；「我轉了」事件由 `GET /api/sync` 帶回、套用後 `POST /api/share/ack`。
- API 與原表相同，另加 `DELETE /api/sync`（停用並刪雲端）、`DELETE /api/share/:id`、`POST /api/share/ack`、`POST /api/share/:id/paid` 支援 `kind: 'unpaid'` 取消。
- 部署：PM2 `banban`（`deploy/ecosystem.config.cjs`），`DATA_DIR=/www/banban-data`，nginx `/api/` 由寶塔反代、`/s/` try_files 到 `dist/s/index.html`。每日 `deploy/backup-db.sh` VACUUM INTO 備份到 `/www/my_www_backup/banban/` 保留 30 天。更新用 `deploy/update.sh`。

### 技術

- Hono（或 Fastify）+ `better-sqlite3`（有 Node 20 arm64 預編譯檔）。
- 單一 SQLite 檔 `server/data/banban.db`，備份 = 複製檔案。
- 以 monorepo 方式放在 `server/`，透過 tsconfig paths 或相對路徑 import `src/lib/*`。

### 端對端加密設計

- 前端現有的 PIN 金鑰不變；同步時上傳的是 **加密後的 blob**，伺服器永遠看不到明文。
- 每個裝置用一組「存取金鑰」（隨機 32 bytes，設定頁顯示、可用 QR 轉到另一台裝置）驗證身分。
- 分享連結：前端為該帳本產生一把隨機 **帳本金鑰**，用它加密帳本快照上傳；連結格式 `https://host/s/<id>#<key>`，`#` 後面的金鑰不會送到伺服器。對方瀏覽器用金鑰解密後，用 `computeSplit()` 算出自己那份。

### API（第一版）

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `PUT` | `/api/sync` | 上傳加密 blob（含版本號，樂觀鎖）。Header：`Authorization: Bearer <存取金鑰>` |
| `GET` | `/api/sync` | 下載最新 blob 與版本號。 |
| `POST` | `/api/share` | 建立分享快照：`{ projectId, cipher, expiresAt }` → `{ id }` |
| `GET` | `/api/share/:id` | 取得快照密文（無需登入）。 |
| `POST` | `/api/share/:id/paid` | 對方按「我轉了」：`{ personId }`。伺服器記錄事件，擁有者下次同步時合併。 |
| `GET` | `/api/share/:id/events` | 擁有者拉取已還事件。 |
| `GET` | `/api/rate?from=JPY&to=TWD&date=2026-09-03` | 匯率代理與快取（可選）。 |

### 資料表

```sql
CREATE TABLE accounts (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, created_at INTEGER);
CREATE TABLE blobs (account_id TEXT PRIMARY KEY, version INTEGER, cipher BLOB, updated_at INTEGER);
CREATE TABLE shares (id TEXT PRIMARY KEY, account_id TEXT, project_id TEXT, cipher BLOB, expires_at INTEGER, created_at INTEGER);
CREATE TABLE share_events (id INTEGER PRIMARY KEY, share_id TEXT, person_id TEXT, kind TEXT, created_at INTEGER);
```

### 前端要加的

- 設定頁「☁️ 同步」：伺服器網址、存取金鑰（產生 / 顯示 QR / 掃描匯入）、上次同步時間、手動同步鈕。
- 結果頁「🔗 產生分享連結」：選擇有效期限，複製連結。
- 分享頁 `/s/:id`：獨立的極簡頁面，顯示對方那份、你的轉帳資訊、「我轉了」按鈕。

### 面板部署步驟

1. 面板「Node 專案」：專案目錄指向 repo 的 `server/`，啟動指令 `npm run start`，Node 20，開機自啟。
2. 環境變數：`PORT=3456`、`DATA_DIR=/www/banban-data`、`CORS_ORIGIN=https://你的網域`。
3. 前端 build 產物（`dist/`）由同一個 Nginx 站台當靜態檔案服務；`/api/*` 與 `/s/*` 反向代理到 `127.0.0.1:3456`。
4. 面板申請 Let's Encrypt 憑證（相機與 PWA 需要 HTTPS）。
5. 定時任務：每天 `cp banban.db banban-$(date +%F).db` 到備份目錄，保留 30 天。

## 第二階段：通知與排程

- Telegram bot（最簡單）或 LINE Messaging API（LINE Notify 已於 2025 停止服務）。
- crontab 每週一早上：列出還沒還的人與金額，推播給自己；可選一鍵轉發給對方。
- 有人按「我轉了」立即推播。

## 第三階段：智慧匯入

- LINE bot 收到收據照片 → 伺服器呼叫視覺模型解析品項 → 建立帳本 → 回傳連結。
- 伺服器端收據辨識取代 Tesseract（準確度大幅提升，還能判斷主餐 / 共享）。
- 財政部電子發票 API：用手機條碼載具自動匯入發票（需申請 AppID）。
- 台灣銀行牌告匯率或信用卡實際匯率。

## 功能待辦（依優先順序）

1. ~~催款訊息產生器：個人化文字 + 轉帳資訊（銀行代碼帳號 / LINE Pay）。~~ ✅ 2026-09-03
2. ~~多人代墊 + 最少轉帳次數的債務簡化。~~ ✅ 2026-09-03（`payments[]`、`simplifyDebts`、settled 改以轉帳 key）
3. ~~部分還款（記錄已還金額而非只有是 / 否）。~~ ✅ 2026-09-03（`partial`）
4. ~~台幣結果取整到 5 或 10 元。~~ ✅ 2026-09-03（`rounding`，外幣帳本取整台幣金額）
5. ~~常用組合範本（固定群組一鍵帶入）。~~ ✅ 2026-09-03（`groups`）
6. 分類與月報表（可愛圖表）。
7. 收據照片附加（注意加密後的儲存空間）。
8. CSV / Excel 匯出、Splitwise 匯入。
9. 旅遊模式：多帳本合併結算。
10. WebAuthn（Face ID / 指紋）解鎖。
11. 權重分攤（0.5 份、1.5 份）、請客模式。
12. 外幣小費計算器。
13. 從付款截圖 OCR 金額，自動標記已還。

## 開發指令

```bash
npm install
npm run dev      # 前端
npm test         # 單元測試
npm run build    # 型別檢查 + 打包
```
