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
 * 依國泰 CUBE 收款碼實測樣本對齊（2026-09-03 解碼）：
 *   TWQRP://個人轉帳/158/02/V1?D5=013&D6=0000699500327859
 * 整串再 encodeURIComponent 一次、帳號補零到 16 位、單位名稱固定「個人轉帳」。
 * 我們多帶 D1（金額，新台幣整數元）與 D10=901（幣別 TWD），讓掃描端把金額也帶入。
 */
export function twqrTransfer(o: { bankCode: string; account: string; amount: number; name?: string }): string | null {
  const bank = o.bankCode.replace(/\D/g, '')
  const acct = o.account.replace(/\D/g, '')
  if (!/^\d{3}$/.test(bank) || acct.length < 6 || acct.length > 16) return null
  if (!(o.amount > 0) || o.amount > 99_999_999) return null
  const dollars = Math.round(o.amount)
  const plain = `TWQRP://個人轉帳/158/02/V1?D1=${dollars}&D5=${bank}&D6=${acct.padStart(16, '0')}&D10=901`
  return encodeURIComponent(plain)
}
