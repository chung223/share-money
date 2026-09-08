/**
 * Heuristic line parser for OCR output / pasted electronic receipts (Uber Eats, foodpanda, 超商, 餐廳).
 * Extracts (name, qty, price) rows and spots the "total" line for cross-checking.
 * Strategy: normalise → merge "name line + price line" pairs → drop noise → pull qty → keep rows with money.
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
  /** Lines we threw away, so the UI can show "過濾了 N 行雜訊" */
  dropped: number
}

const TOTAL_WORDS = /(總計|合計|總額|應付|實付|實收|小計|總金額|付款金額|訂單金額|應收|total|amount due|grand total|subtotal)/i
const SKIP_WORDS =
  /(找零|現金|信用卡|刷卡|發票|統編|統一編號|載具|隨機碼|序號|電話|tel|地址|收銀|機號|交易|時間|日期|date|time|會員|點數|卡號|line ?pay|悠遊|一卡通|街口|apple ?pay|稅額|稅率|營業稅|tax|vat|change|cash|card|visa|master|jcb|thank|謝謝|歡迎|welcome|備註|訂單編號|訂單號|order (no|id|#)|www\.|https?:|\S+@\S+\.\S+|桌號|table\s*\d|人數|服務員|店號|店名|分店|營業|外送費|運費|平台費|服務費|優惠|折抵|折扣碼|coupon|promo|delivery fee|service fee|platform fee|tip|小費|預估|抵達|送達|評分|已完成|已送達|共\s*\d+\s*[件項樣份]|件數|品項數|數量\s*[:：]?\s*\d+\s*$|^\s*(page|頁)\s*\d)/i
const NOISE_LINE = /^[\s\-_=*.·•・…—–~#|]+$|^\d{2,4}[-/]\d{1,2}[-/]\d{1,2}|^\d{1,2}:\d{2}|^(0\d{1,3}[-\s]?\d{3,4}[-\s]?\d{3,4})$|^[A-Z]{2}\d{8}$|^\d{8,}$/
const DATE_RE = /(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/
const CUR = '(?:NT\\$|N\\$|\\$|¥|￥|₩|€|£|TWD|JPY|USD|HKD|KRW|元|円)?'
/** Money at end of line: "120", "1,280", "NT$120", "$ 12.50", "120元", "TX"/"T" 稅別後綴 */
const MONEY_END = new RegExp(`${CUR}\\s*(-?\\d{1,3}(?:,\\d{3})+|-?\\d+)(?:\\.(\\d{1,2}))?\\s*(?:元|円|TX|TE|T|\\*|%)?\\s*$`, 'i')
/** Money at start of line: "$65 珍珠奶茶", "NT$ 120 牛肉麵" */
const MONEY_START = new RegExp(`^${CUR}\\s*(-?\\d{1,3}(?:,\\d{3})+|-?\\d+)(?:\\.(\\d{1,2}))?\\s*(?:元|円)?\\s+(?=\\S)`, 'i')
const ONLY_MONEY = new RegExp(`^${CUR}\\s*(-?\\d{1,3}(?:,\\d{3})+|-?\\d+)(?:\\.(\\d{1,2}))?\\s*(?:元|円|TX|TE|T|\\*)?$`, 'i')
const QTY_RE = /(?:(?:^|\s)[x×*]\s*(\d{1,3})(?=\s|$))|(?:(?:^|\s)(\d{1,3})\s*(?:x|×|個|份|杯|件|碗|盤|瓶|罐|包|pcs?)(?=\s|$))|(?:^(\d{1,3})\s+(?=\D))/i
const UNIT_PRICE_RE = /(?:@|單價|各)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i

function toAmount(int: string, dec?: string) {
  const n = Number(int.replace(/,/g, '') + (dec ? '.' + dec : ''))
  return Number.isFinite(n) ? n : null
}
function clean(name: string) {
  return name
    .replace(/^[\s\-_=*.·•・>»◆■●▪\d]{0,3}(?:[.)、]\s*)?/, '') // bullets & "1." item numbers
    .replace(/[\s.:：·\-_=…]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function parseReceiptText(text: string): ParsedReceipt {
  const rows: ParsedRow[] = []
  let total: number | null = null
  let date: string | null = null
  let dropped = 0
  const raw = text
    .replace(/\t/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').replace(/^[\-•・*·>»◆■●▪]+\s*/, '').trim())
    .filter(Boolean)

  // Merge "name" + "price-only" line pairs (common in Uber Eats / foodpanda copy-paste).
  const lines: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i]
    const next = raw[i + 1]
    if (next && !MONEY_END.test(cur) && ONLY_MONEY.test(next) && !TOTAL_WORDS.test(cur) && !SKIP_WORDS.test(cur)) {
      lines.push(`${cur} ${next}`)
      i++
    } else lines.push(cur)
  }

  for (const line of lines) {
    if (!date) {
      const d = DATE_RE.exec(line)
      if (d) date = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`
    }
    if (NOISE_LINE.test(line)) {
      dropped++
      continue
    }
    let amount: number | null = null
    let name = ''
    const mEnd = MONEY_END.exec(line)
    const mStart = MONEY_START.exec(line)
    if (mEnd && !(ONLY_MONEY.test(line) && !mStart)) {
      amount = toAmount(mEnd[1], mEnd[2])
      name = line.slice(0, mEnd.index)
    } else if (mStart) {
      amount = toAmount(mStart[1], mStart[2])
      name = line.slice(mStart[0].length)
    }
    if (amount == null) {
      dropped++
      continue
    }
    if (TOTAL_WORDS.test(line)) {
      if (total == null || amount > total) total = amount
      continue
    }
    if (SKIP_WORDS.test(line) || amount === 0) {
      dropped++
      continue
    }
    let qty = 1
    let unit: number | null = null
    const u = UNIT_PRICE_RE.exec(name)
    if (u) {
      unit = Number(u[1])
      name = name.replace(u[0], ' ')
    }
    const q = QTY_RE.exec(name)
    if (q) {
      const n = Number(q[1] ?? q[2] ?? q[3])
      if (n > 0 && n < 100) {
        qty = n
        name = name.replace(q[0], ' ')
      }
    }
    name = clean(name)
    if (name.length < 1 || /^\d+$/.test(name) || /^[A-Z0-9\-]{6,}$/.test(name)) {
      dropped++
      continue
    }
    // amount on the line is usually the line total; store unit price accordingly
    const price = unit ?? (qty > 1 ? Math.round((amount / qty) * 100) / 100 : amount)
    rows.push({ name, qty, price, raw: line })
  }
  return { rows, total, date, dropped }
}
