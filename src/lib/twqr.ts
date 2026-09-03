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

export function twqrTransfer(o: { bankCode: string; account: string; amount: number; name?: string }): string | null {
  const bank = o.bankCode.replace(/\D/g, '')
  const acct = o.account.replace(/[^\d]/g, '')
  if (!/^\d{3}$/.test(bank) || acct.length < 6 || acct.length > 16) return null
  if (!(o.amount > 0) || o.amount > 99_999_999) return null
  const cents = Math.round(o.amount * 100)
  const name = encodeURIComponent((o.name || '轉帳').slice(0, 20))
  return `TWQRP://${name}/158/02/V1?D1=${cents}&D5=${bank}&D6=${acct}&D10=901`
}
