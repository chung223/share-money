/**
 * 台灣行動支付：
 * - TWQR（財金公司 QR Code 共通支付標準）轉帳 QR：銀行 App / 台灣 Pay 掃描後帶入收款帳號與金額。
 *   格式：TWQRP://<顯示名稱>/158/02/V1?D1=<金額，單位分>&D5=<銀行代碼>&D6=<帳號>&D10=901（901 = 新台幣）
 * - LINE Pay / 街口 只有「打開 App」的 scheme，沒有帶金額的轉帳連結；所以先把金額複製到剪貼簿再開。
 */
export type QuickPayApp = 'linepay' | 'jkopay' | 'twpay'

export const QUICK_PAY: { id: QuickPayApp; label: string; emoji: string; scheme: string; hint: string }[] = [
  { id: 'linepay', label: 'LINE Pay', emoji: '💚', scheme: 'line://pay/generateQR', hint: '打開 LINE Pay 後到「轉帳」選對方，金額已幫你複製' },
  { id: 'jkopay', label: '街口', emoji: '🟥', scheme: 'jkopay://', hint: '打開街口後選「轉帳」，金額已幫你複製' },
  { id: 'twpay', label: '台灣 Pay', emoji: '🏦', scheme: 'twmp://', hint: '打開台灣 Pay 後掃上面的 QR，帳號金額自動帶入' },
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
