/**
 * Taiwan e-invoice (電子發票證明聯) QR code parser.
 *
 * Left QR (77 fixed chars + colon-separated tail):
 *   [0,10)  invoice number (2 letters + 8 digits)
 *   [10,17) ROC date yyyMMdd
 *   [17,21) random code
 *   [21,29) sales amount (hex)
 *   [29,37) total amount (hex)
 *   [37,45) buyer tax id
 *   [45,53) seller tax id
 *   [53,77) encrypted verification
 *   then ":" + business area(10) ":" + items-in-this-qr ":" + total-items ":" + encoding(0 Big5,1 UTF8,2 Base64)
 *   then ":" name ":" qty ":" unit price ... repeated
 * Right QR: starts with "**" and continues name:qty:price triples.
 */
export interface EInvoiceItem {
  name: string
  qty: number
  price: number
}

export interface EInvoiceLeft {
  kind: 'left'
  number: string
  date: string // YYYY-MM-DD
  total: number
  sales: number
  sellerId: string
  itemsInQr: number
  itemsTotal: number
  encoding: 0 | 1 | 2
  items: EInvoiceItem[]
}

export interface EInvoiceRight {
  kind: 'right'
  items: EInvoiceItem[]
}

export type EInvoicePart = EInvoiceLeft | EInvoiceRight

const LEFT_RE = /^[A-Z]{2}\d{8}\d{7}\d{4}[0-9A-Fa-f]{8}[0-9A-Fa-f]{8}[0-9A-Za-z]{8}[0-9A-Za-z]{8}/

export function looksLikeLeft(text: string) {
  return LEFT_RE.test(text)
}
export function looksLikeRight(text: string) {
  return text.startsWith('**')
}

function parseTriples(parts: string[]): EInvoiceItem[] {
  const items: EInvoiceItem[] = []
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const name = parts[i].trim()
    const qty = Number(parts[i + 1])
    const price = Number(parts[i + 2])
    if (!name || Number.isNaN(qty) || Number.isNaN(price)) continue
    items.push({ name, qty: qty || 1, price })
  }
  return items
}

function decodeBase64Utf8(b64: string) {
  const bin = atob(b64.replace(/\s+/g, ''))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

export function parseEInvoice(text: string): EInvoicePart | null {
  if (looksLikeRight(text)) {
    const body = text.slice(2)
    return { kind: 'right', items: parseTriples(body.split(':')) }
  }
  if (!looksLikeLeft(text)) return null
  const head = text.slice(0, 77)
  const number = head.slice(0, 10)
  const roc = head.slice(10, 17)
  const year = Number(roc.slice(0, 3)) + 1911
  const date = `${year}-${roc.slice(3, 5)}-${roc.slice(5, 7)}`
  const sales = parseInt(head.slice(21, 29), 16)
  const total = parseInt(head.slice(29, 37), 16)
  const sellerId = head.slice(45, 53)
  const tail = text.slice(77)
  const parts = tail.startsWith(':') ? tail.slice(1).split(':') : tail.split(':')
  // parts[0] = business area, [1] items in qr, [2] total items, [3] encoding, then triples
  const itemsInQr = Number(parts[1] ?? 0) || 0
  const itemsTotal = Number(parts[2] ?? 0) || 0
  const encodingRaw = Number(parts[3] ?? 1)
  const encoding = (encodingRaw === 0 || encodingRaw === 2 ? encodingRaw : 1) as 0 | 1 | 2
  let itemParts = parts.slice(4)
  if (encoding === 2 && itemParts.length) {
    try {
      itemParts = decodeBase64Utf8(itemParts.join(':')).split(':')
    } catch {
      /* keep raw */
    }
  }
  return { kind: 'left', number, date, total, sales, sellerId, itemsInQr, itemsTotal, encoding, items: parseTriples(itemParts) }
}

/** Merge a left and (optional) right part into a final item list. */
export function mergeEInvoice(left: EInvoiceLeft, right?: EInvoiceRight | null) {
  const items = [...left.items, ...(right?.items ?? [])]
  // De-duplicate in case both QR codes were scanned repeatedly.
  const complete = left.itemsTotal === 0 || items.length >= left.itemsTotal
  return { items, complete, total: left.total, date: left.date, number: left.number }
}

/** Decode raw QR bytes using the encoding flag in the left QR (Big5 vs UTF-8). */
export function decodeQrBytes(bytes: Uint8Array | number[], text: string): string {
  // jsQR decodes as UTF-8 by default; if we detect a Big5 flag in the header, re-decode.
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
  try {
    const ascii = new TextDecoder('utf-8', { fatal: false }).decode(arr)
    if (looksLikeLeft(ascii)) {
      const parts = ascii.slice(77).replace(/^:/, '').split(':')
      if (parts[3] === '0') return new TextDecoder('big5').decode(arr)
    }
    if (looksLikeRight(ascii) && /�/.test(ascii)) {
      return new TextDecoder('big5').decode(arr)
    }
  } catch {
    /* fall through */
  }
  return text
}
