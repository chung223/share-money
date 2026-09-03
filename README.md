# 반반 BanBan · 半半分帳

> 你先付，我來算。可愛又無腦的分帳小工具，專為常常代墊的人設計。

「반반（banban）」是韓文的「一半一半」，就像半半炸雞一樣，把帳分得剛剛好。

## 功能

- 🍽 **每餐一個帳本**：聚餐、外送、計程車、旅行都能開一個。
- 🍕 **三種分法**
  - 均攤：輸入總額，除以人數。
  - 各點各的：每個品項點誰吃，多人選就自動均分。
  - 主餐 + 共享：主餐各付各的，小菜飲料大家分。
- 🧂 **額外費用**：服務費 %、外送費、小費、折扣，可按比例或平均分。
- 🧾 **匯入明細**
  - 掃台灣電子發票 QR（左右兩顆都會讀，品項自動帶入）。
  - 拍照 OCR（Tesseract.js，中英文，在裝置上辨識，照片不上傳）。
  - 貼上文字（Uber Eats、foodpanda 訂單文字也行）。
- 💱 **外幣與匯率**：依帳本日期自動抓當天匯率，也可手動輸入，結果同時顯示原幣與台幣。
- 🔐 **隱私鎖**：4 位 PIN，資料用 AES-GCM 加密存在裝置，切到背景自動上鎖。
- ✅ **收款追蹤**：誰還了誰沒還一目瞭然，全收齊會撒花。
- 📤 **一鍵分享**：產生文字直接貼到 LINE 群組。
- 🌙 **深色模式**、📱 **PWA**（可加到手機主畫面、離線可用）。

## 資料在哪裡？

全部只存在你的瀏覽器（IndexedDB）裡，沒有後端、不上傳。唯一的對外請求是抓匯率，只送出幣別與日期。設定 PIN 後資料會加密，PIN 本身不會被儲存；忘記 PIN 只能清除資料重來。記得定期在設定頁「匯出備份」。

## 部署到 GitHub Pages

1. 把這個分支合併到 `main`。
2. GitHub 專案 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
3. 之後每次推到 `main` 會自動部署到 `https://<你的帳號>.github.io/share-money/`。

手機開啟後用「加入主畫面」，就像原生 App 一樣（相機掃描需要 HTTPS，GitHub Pages 預設就有）。

## 開發

```bash
npm install
npm run dev      # 開發伺服器
npm test         # 拆帳引擎、發票解析、明細解析的單元測試
npm run build    # 型別檢查 + 打包到 dist/
npm run icons    # 從 public/icon.svg 重新產生 PWA 圖示
```

技術：Vite + React + TypeScript、zustand、jsQR、Tesseract.js、idb-keyval、vite-plugin-pwa。
