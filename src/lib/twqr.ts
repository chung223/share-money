/**
 * 台灣行動支付：
 * - TWQR（財金公司 QR Code 共通支付標準）轉帳 QR：銀行 App / 台灣 Pay 掃描後帶入收款帳號與金額。
 *   格式：TWQRP://<顯示名稱>/158/02/V1?D1=<金額，單位分>&D5=<銀行代碼>&D6=<帳號>&D10=901（901 = 新台幣）
 * - LINE Pay / 街口 只有「打開 App」的 scheme，沒有帶金額的轉帳連結；所以先把金額複製到剪貼簿再開。
 */
export type QuickPayApp = 'linepay' | 'jkopay' | 'twpay' | 'pxpay'

/**
 * 2026-09-04 上網核對過的 URL scheme（數位時代／蘋果仁／PTT iOS 板／kinta.ma 整理）：
 * - 街口 jkos://transfer 直接開「轉帳」頁（但不帶對象與金額）
 * - LINE Pay 只有 generateQR（付款碼）與 scanQR（掃碼），沒有轉帳頁
 * - 台灣 Pay twmpshortcut://?type=scan 開掃碼
 * - 全支付 com.pxpay.plus://vmykjjouv 開轉帳
 * 沒有任何一家公開「帶金額轉帳」的連結。
 */
export const QUICK_PAY: { id: QuickPayApp; label: string; emoji: string; scheme: string; hint: string }[] = [
  { id: 'jkopay', label: '街口轉帳', emoji: '🟥', scheme: 'jkos://transfer', hint: '街口轉帳頁已開，選對方、貼上金額' },
  { id: 'linepay', label: 'LINE Pay', emoji: '💚', scheme: 'line://pay/generateQR', hint: '到 LINE Pay 的「轉帳」選對方，金額已幫你複製' },
  { id: 'pxpay', label: '全支付轉帳', emoji: '🟩', scheme: 'com.pxpay.plus://vmykjjouv', hint: '全支付轉帳頁已開，貼上金額' },
  { id: 'twpay', label: '台灣 Pay 掃碼', emoji: '🏦', scheme: 'twmpshortcut://?type=scan', hint: '用它掃另一台螢幕上的 QR；同一支手機請先存 QR 圖再從相簿選' },
]

/** 使用者自訂範本的佔位符（與 OpenTWQR 相同）。 */
export const APP_LINK_PLACEHOLDERS = ['{account}', '{paddedAccount}', '{bankCode}', '{amount}', '{amountCents}', '{note}'] as const

export function buildAppUrl(template: string, o: { bankCode?: string; account?: string; amount: number; note?: string }): string {
  const acct = (o.account ?? '').replace(/\D/g, '')
  const amount = Math.round(o.amount)
  return template
    .trim()
    .replace(/\{account\}/g, acct)
    .replace(/\{paddedAccount\}/g, acct.replace(/^0+/, '').padStart(16, '0'))
    .replace(/\{bankCode\}/g, (o.bankCode ?? '').replace(/\D/g, ''))
    .replace(/\{amount\}/g, String(amount))
    .replace(/\{amountCents\}/g, String(amount * 100))
    .replace(/\{note\}/g, encodeURIComponent(o.note ?? ''))
}

/** 只允許 app scheme / intent / https，擋 javascript: 之類。 */
export function isSafeAppUrl(u: string) {
  return /^(?:[a-z][a-z0-9+.-]{1,30}:\/\/|intent:|https:\/\/)/i.test(u.trim()) && !/^(javascript|data|vbscript|file):/i.test(u.trim())
}

/** 常見 App 的範本，讓使用者一鍵加入再自己改。 */
export const APP_LINK_PRESETS: { label: string; template: string }[] = [
  { label: '街口 掃碼', template: 'jkos://scanQRCode' },
  { label: 'LINE Pay 掃碼', template: 'line://pay/scanQR' },
  { label: '玉山 Wallet 掃碼', template: 'esunwallet://scanpay' },
  { label: '全支付 掃碼', template: 'com.pxpay.plus://nlauluf' },
  { label: 'Richart Life 掃碼', template: 'cardaily://?stateName=N000001_001' },
  { label: 'Pi 拍錢包 掃碼', template: 'pi://widget/Scanner' },
  { label: 'iPASS Money 掃碼', template: 'ipassmoney://cpm/scanner_pay' },
  { label: 'iPASS Money 付款碼', template: 'https://nwww.ipasspay.com.tw/online/mpm/mycode_pay' },
  { label: '悠遊付 付款碼', template: 'tw.com.easycard.easycardwallet://paymentCode' },
  { label: '台灣 Pay 付款碼', template: 'twmpshortcut://?type=payment' },
]

/**
 * 格式對齊 OpenTWQR（https://github.com/garyellow/OpenTWQR，社群實測可被各銀行 App 掃）：
 *   TWQRP://xn--gmqw5ax42ad01c/158/02/V1?D5=<行代>&D6=<帳號補零16位>&D1=<金額，單位「分」>&D10=901&D9=<備註>
 * 主機名是「個人轉帳」的 punycode。國泰 CUBE 的收款碼則是整串 percent-encode 的變體，掃描端兩種都吃。
 */
export function twqrTransfer(o: { bankCode: string; account: string; amount: number; note?: string }): string | null {
  const bank = o.bankCode.replace(/\D/g, '')
  const acct = o.account.replace(/\D/g, '').replace(/^0+/, '').slice(0, 16)
  if (!/^\d{3}$/.test(bank) || acct.length < 1) return null
  if (!(o.amount > 0) || o.amount > 2_000_000) return null
  const q = new URLSearchParams()
  q.append('D5', bank)
  q.append('D6', acct.padStart(16, '0'))
  q.append('D1', String(Math.round(o.amount * 100)))
  q.append('D10', '901')
  const note = (o.note ?? '').replace(/[\p{Extended_Pictographic}\u0000-\u001F]/gu, '').trim().slice(0, 20)
  if (note) q.append('D9', note)
  return `TWQRP://xn--gmqw5ax42ad01c/158/02/V1?${q.toString()}`
}
