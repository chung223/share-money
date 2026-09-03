/**
 * Heuristic line parser for OCR output / pasted electronic receipts.
 * Extracts (name, qty, price) rows and spots the "total" line for cross-checking.
 */
export interface ParsedRow {
  name: string
  qty: number
  price: number
  raw: string
}
export interface ParsedReceipt {
  rows: ParsedRow[]
  total: number | null
  date: string | null
}

const TOTAL_WORDS = /(總計|合計|總額|應付|實付|實收|小計|總金額|付款金額|total|amount due|grand total)/i
const SKIP_WORDS = /(找零|現金|信用卡|刷卡|發票|統編|統一編號|載具|隨機碼|序號|電話|tel|地址|收銀|機號|交易|時間|日期|date|time|會員|點數|卡號|line pay|悠遊|稅額|tax|vat|change|cash|card|visa|master|thank|謝謝|歡迎|welcome|備註|訂單編號|order no|www\.|http)/i
const DATE_RE = /(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/

/** Money at end of line: "120", "1,280", "NT$120", "$ 12.50", "120元", "TX" suffix ok */
const MONEY_END = /(?:NT\$|\$|¥|₩|€|£|TWD|JPY|USD)?\s*(-?\d{1,3}(?:,\d{3})+|-?\d+)(?:\.(\d{1,2}))?\s*(?:元|円|TX|T|\*)?\s*$/i
const QTY_RE = /(?:(?:^|\s)[x×*]\s*(\d{1,3})(?=\s|$))|(?:(?:^|\s)(\d{1,3})\s*(?:x|×|個|份|杯|件|pcs?)(?=\s|$))/i

export function parseReceiptText(text: string): ParsedReceipt {
  const rows: ParsedRow[] = []
  let total: number | null = null
  let date: string | null = null
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  for (const line of lines) {
    if (!date) {
      const d = DATE_RE.exec(line)
      if (d) date = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`
    }
    const m = MONEY_END.exec(line)
    if (!m) continue
    const amount = Number(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''))
    if (Number.isNaN(amount)) continue
    let name = line.slice(0, m.index).replace(/[\s.:：·\-_=]+$/g, '').trim()
    if (TOTAL_WORDS.test(line)) {
      // prefer the biggest "total-ish" number we see
      if (total == null || amount > total) total = amount
      continue
    }
    if (SKIP_WORDS.test(line)) continue
    if (!name) continue
    if (amount === 0) continue
    let qty = 1
    const q = QTY_RE.exec(name)
    if (q) {
      const n = Number(q[1] ?? q[2])
      if (n > 0 && n < 100) {
        qty = n
        name = name.replace(q[0], ' ').trim()
      }
    }
    // Drop leading item numbers like "1." or "01"
    name = name.replace(/^\d{1,2}[.)]\s*/, '').trim()
    if (name.length < 1 || /^\d+$/.test(name)) continue
    // amount on the line is usually the line total; store unit price accordingly
    const price = qty > 1 ? Math.round((amount / qty) * 100) / 100 : amount
    rows.push({ name, qty, price, raw: line })
  }
  return { rows, total, date }
}
