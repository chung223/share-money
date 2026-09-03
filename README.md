# 반반 BanBan · 半半分帳

> 你先付，我來算。可愛又無腦的分帳小工具，專為常常代墊的人設計。

「반반（banban）」是韓文的「一半一半」，就像半半炸雞一樣，把帳分得剛剛好。

## 功能

- 🗂 **每次代墊一個帳本**：吃飯、交通、購物、旅遊、娛樂、其他六種分類，文案和圖示跟著分類走，首頁可篩選。
- 🍕 **三種分法**
  - 均攤：輸入總額，除以人數。
  - 各點各的：每個品項點誰吃，多人選就自動均分。
  - 主餐 + 共享：主餐各付各的，小菜飲料大家分。
- 🧂 **額外費用**：服務費 %、外送費、小費、折扣，可按比例或平均分。
- 🧾 **匯入明細**
  - 掃台灣電子發票 QR（左右兩顆都會讀，品項自動帶入）。
  - 拍照、相簿圖片或 **PDF**（電子帳單抽文字層，掃描檔轉圖）。
  - 預設 Tesseract.js 在裝置上辨識、不上傳；可切換 **✨ AI 辨識**（MiniMax 多模態，準很多，每天有次數上限，圖片處理完即丟）。
  - 貼上文字（Uber Eats、foodpanda、Email 收據整段貼），自動過濾電話、發票號碼、找零等雜訊；亂的可用 AI 整理。
- 💱 **外幣與匯率**：依帳本日期自動抓當天匯率，也可手動輸入，結果同時顯示原幣與台幣。
- 🔐 **隱私鎖**：4 位 PIN，資料用 AES-GCM 加密存在裝置，切到背景自動上鎖。
- ✅ **收款追蹤**：誰還了誰沒還一目瞭然，全收齊會撒花。
- 📤 **一鍵分享**：產生文字直接貼到 LINE 群組。
- 🌙 **深色模式**、📱 **PWA**（可加到手機主畫面、離線可用）。

- ☁️ **多裝置同步**（端對端加密）：一把金鑰、掃 QR 就能把手機和電腦連起來，伺服器只存亂碼。
- 🔗 **給朋友的連結**：朋友點開看自己那份和你的收款資訊，按「我轉了」你這邊自動打勾。
- 💳 **收款方式**：銀行代碼帳號、LINE Pay / 街口連結，放在分享頁上。
- 📣 **催款訊息**：三種語氣、附收款資訊與連結，一鍵複製貼給對方。
- 💸 **多人先付**：你付餐、朋友付車，自動算出最少轉幾次結清。
- 🪙 **部分還款、取整到 5 / 10**、🍱 **常用組合**一鍵開帳本。
- 🔔 **推播通知**：朋友按「我轉了」立刻通知你（iPhone 需加入主畫面）。對方還能留備註（LINE Pay、末五碼），備註用連結金鑰加密。
- 📖 第一次打開有新手教學，設好名字後不再出現；設定頁可重看。

## 資料在哪裡？

預設只存在你的瀏覽器（IndexedDB）裡。設定 PIN 後資料會加密，PIN 本身不會被儲存；忘記 PIN 只能清除資料重來。

開了「多裝置同步」之後，資料會先用同步金鑰派生的 AES 金鑰加密再上傳，伺服器（`server/`）只看得到密文和版本號；分享連結的內容也是加密的，解密金鑰在網址 `#` 後面、不會送到伺服器。對外請求只有：抓匯率（幣別與日期）、同步、分享。記得定期在設定頁「匯出備份」。

## 部署

正式站：`https://spilt.chung.men`（VPS + aaPanel + PM2 + Nginx）。細節見 [`docs/ROADMAP.md`](docs/ROADMAP.md) 與 `deploy/`：

```bash
deploy/update.sh        # git pull → npm ci（前後端）→ 測試 → build → pm2 restart banban
deploy/backup-db.sh     # 每日 SQLite 備份（cron）
```

GitHub Pages（純前端、沒有同步與分享功能）仍會在推到 `main` 時自動部署到 `https://chung223.github.io/share-money/`。

## 後端

```bash
cd server && npm install
npm run dev      # http://127.0.0.1:3456，資料在 server/data/
npm run typecheck
```

環境變數：`PORT`（3456）、`DATA_DIR`、`CORS_ORIGIN`。前端 `npm run dev` 會把 `/api` 代理到本機後端。

## 開發

```bash
npm install
npm run dev      # 開發伺服器
npm test         # 拆帳引擎、發票解析、同步合併、後端 API 的單元測試
npm run build    # 型別檢查 + 打包到 dist/
npm run icons    # 從 public/icon.svg 重新產生 PWA 圖示
```

技術：Vite + React + TypeScript、zustand、jsQR、Tesseract.js、idb-keyval、vite-plugin-pwa、qrcode；後端 Hono + node:sqlite。
