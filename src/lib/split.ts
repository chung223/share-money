import type { Extra, Id, Item, Person, Project } from './types'
import { currencyMeta } from './types'

export interface PersonShareLine {
  itemId: Id
  name: string
  amount: number // this person's share of this item, project currency
  qty: number
  sharers: number
}

export interface PersonResult {
  person: Person
  lines: PersonShareLine[]
  subtotal: number // items only, project currency
  extras: { extraId: Id; name: string; emoji: string; amount: number }[]
  total: number // project currency, unrounded
  totalRounded: number // project currency, rounded to currency decimals, drift-corrected
  baseTotal: number | null // base currency, rounded, drift-corrected (null when no rate)
  /** Paid up front (project currency, rounded). Single-payer: grand total for the payer, 0 for others. */
  paid: number
  /** paid - totalRounded: positive = others owe this person. */
  net: number
  isPayer: boolean
  /** All of this person's outgoing transfers are done (true when there are none). */
  settled: boolean
}

export interface Transfer {
  key: string
  from: Id
  to: Id
  amount: number // project currency
  baseAmount: number | null
  settled: boolean
}

export interface SplitResult {
  people: PersonResult[]
  itemsTotal: number
  extrasTotal: number
  grandTotal: number
  grandTotalRounded: number
  baseGrandTotal: number | null
  unassigned: Item[] // items nobody shares (excluded from totals)
  /** Who pays whom (already minimised for multi-payer). */
  transfers: Transfer[]
  multiPayer: boolean
  /** Multi-payer only: payments sum minus grand total (0 when it adds up). */
  paymentsDiff: number
}

export function transferKey(from: Id, to: Id) {
  return `${from}_${to}`
}

export function hasMultiPayer(project: Project) {
  return !!project.payments && project.payments.filter((x) => x.amount > 0).length > 0
}

/** Legacy data marked `settled[personId]` meaning "paid the (single) payer back". */
export function isTransferSettled(settled: Record<string, boolean>, from: Id, to: Id, payerId: Id) {
  const k = transferKey(from, to)
  if (k in settled) return !!settled[k]
  return to === payerId && !!settled[from]
}

/**
 * Greedy debt simplification: match the biggest creditor with the biggest debtor until everyone is
 * at zero. Not guaranteed minimal in general, but optimal enough for a handful of friends.
 */
export function simplifyDebts(nets: { id: Id; net: number }[], decimals: number): { from: Id; to: Id; amount: number }[] {
  const f = 10 ** decimals
  const unit = 1 / f
  const creditors = nets.filter((x) => x.net > unit / 2).map((x) => ({ id: x.id, left: Math.round(x.net * f) }))
  const debtors = nets.filter((x) => x.net < -unit / 2).map((x) => ({ id: x.id, left: Math.round(-x.net * f) }))
  const out: { from: Id; to: Id; amount: number }[] = []
  creditors.sort((a, b) => b.left - a.left)
  debtors.sort((a, b) => b.left - a.left)
  let i = 0
  let j = 0
  while (i < creditors.length && j < debtors.length) {
    const c = creditors[i]
    const d = debtors[j]
    const amt = Math.min(c.left, d.left)
    if (amt > 0) out.push({ from: d.id, to: c.id, amount: amt / f })
    c.left -= amt
    d.left -= amt
    if (c.left === 0) i += 1
    if (d.left === 0) j += 1
  }
  return out
}

export function itemTotal(item: Item) {
  return round2(item.price * (item.qty || 1))
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export function roundTo(n: number, decimals: number) {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/**
 * Rounds each share to `decimals` while ensuring the sum equals the rounded total
 * (largest-remainder method). Keeps everyone's number honest and the total exact.
 */
export function distributeRounding(shares: number[], decimals: number): number[] {
  const f = 10 ** decimals
  const total = Math.round(shares.reduce((a, b) => a + b, 0) * f)
  const floored = shares.map((s) => Math.floor(s * f + 1e-9))
  let diff = total - floored.reduce((a, b) => a + b, 0)
  const order = shares
    .map((s, i) => ({ i, rem: s * f - floored[i] }))
    .sort((a, b) => b.rem - a.rem)
  const out = [...floored]
  let k = 0
  while (diff > 0 && order.length) {
    out[order[k % order.length].i] += 1
    diff -= 1
    k += 1
  }
  while (diff < 0 && order.length) {
    const idx = order[order.length - 1 - (k % order.length)].i
    out[idx] -= 1
    diff += 1
    k += 1
  }
  return out.map((v) => v / f)
}

export function resolveSharers(item: Item, project: Project): Id[] {
  const ids = project.people.map((p) => p.id)
  if (project.mode === 'equal') return ids
  if (item.sharedBy === 'all') return ids
  return item.sharedBy.filter((id) => ids.includes(id))
}

export function computeSplit(project: Project): SplitResult {
  const people = project.people
  const n = people.length
  const decimals = currencyMeta(project.currency).decimals
  const baseDecimals = 0 // base currency rounding is decided by the caller via baseCurrency; default TWD-like
  const perPerson = new Map<Id, PersonResult>()
  for (const p of people) {
    perPerson.set(p.id, {
      person: p,
      lines: [],
      subtotal: 0,
      extras: [],
      total: 0,
      totalRounded: 0,
      baseTotal: null,
      paid: 0,
      net: 0,
      isPayer: p.id === project.payerId,
      settled: true,
    })
  }

  const unassigned: Item[] = []
  let itemsTotal = 0
  for (const item of project.items) {
    const sharers = resolveSharers(item, project)
    const total = itemTotal(item)
    if (!sharers.length || total === 0) {
      if (!sharers.length && total !== 0) unassigned.push(item)
      continue
    }
    itemsTotal += total
    const each = total / sharers.length
    for (const id of sharers) {
      const r = perPerson.get(id)!
      r.lines.push({ itemId: item.id, name: item.name, amount: each, qty: item.qty, sharers: sharers.length })
      r.subtotal += each
    }
  }

  let extrasTotal = 0
  for (const extra of project.extras) {
    const amount = extraAmount(extra, itemsTotal)
    if (!amount || !n) continue
    extrasTotal += amount
    for (const p of people) {
      const r = perPerson.get(p.id)!
      let share: number
      if (extra.split === 'equal' || itemsTotal === 0) share = amount / n
      else share = (amount * r.subtotal) / itemsTotal
      r.extras.push({ extraId: extra.id, name: extra.name, emoji: extra.emoji, amount: share })
      r.total += share
    }
  }
  for (const r of perPerson.values()) r.total += r.subtotal

  const results = people.map((p) => perPerson.get(p.id)!)
  const rounded = distributeRounding(
    results.map((r) => r.total),
    decimals,
  )
  results.forEach((r, i) => (r.totalRounded = rounded[i]))

  const grandTotal = itemsTotal + extrasTotal
  const grandTotalRounded = roundTo(grandTotal, decimals)

  let baseGrandTotal: number | null = null
  if (project.rate != null && project.rate > 0) {
    const baseShares = distributeRounding(
      results.map((r) => r.total * project.rate!),
      baseDecimals,
    )
    results.forEach((r, i) => (r.baseTotal = baseShares[i]))
    baseGrandTotal = roundTo(grandTotal * project.rate, baseDecimals)
  }

  // ---- who paid, who owes whom ----
  const multiPayer = hasMultiPayer(project)
  let paymentsDiff = 0
  if (multiPayer) {
    for (const pay of project.payments!) {
      const r = perPerson.get(pay.personId)
      if (r) r.paid += roundTo(pay.amount, decimals)
    }
    paymentsDiff = roundTo(results.reduce((a, r) => a + r.paid, 0) - grandTotalRounded, decimals)
  } else {
    const payer = perPerson.get(project.payerId)
    if (payer) payer.paid = grandTotalRounded
  }
  for (const r of results) r.net = roundTo(r.paid - r.totalRounded, decimals)

  let raw: { from: Id; to: Id; amount: number }[]
  if (multiPayer) raw = simplifyDebts(results.map((r) => ({ id: r.person.id, net: r.net })), decimals)
  else raw = results.filter((r) => !r.isPayer && r.totalRounded > 0).map((r) => ({ from: r.person.id, to: project.payerId, amount: r.totalRounded }))
  const rate = project.rate != null && project.rate > 0 ? project.rate : null
  const transfers: Transfer[] = raw.map((t) => ({
    key: transferKey(t.from, t.to),
    from: t.from,
    to: t.to,
    amount: t.amount,
    baseAmount: rate ? roundTo(t.amount * rate, baseDecimals) : null,
    settled: isTransferSettled(project.settled, t.from, t.to, project.payerId),
  }))
  // keep per-person base amounts consistent with the drift-corrected totals in single-payer mode
  if (!multiPayer) for (const t of transfers) t.baseAmount = perPerson.get(t.from)!.baseTotal
  for (const r of results) {
    const mine = transfers.filter((t) => t.from === r.person.id)
    r.settled = mine.every((t) => t.settled)
    if (!multiPayer && r.isPayer) r.settled = true
  }

  return { people: results, itemsTotal, extrasTotal, grandTotal, grandTotalRounded, baseGrandTotal, unassigned, transfers, multiPayer, paymentsDiff }
}

export function extraAmount(extra: Extra, itemsTotal: number) {
  if (extra.type === 'percent') return round2((itemsTotal * extra.value) / 100)
  return extra.value
}

/** Text summary for sharing (LINE, etc.). */
export function summaryText(project: Project, result: SplitResult, baseCurrency: string): string {
  const cur = currencyMeta(project.currency)
  const fmt = (n: number) => fmtMoney(n, project.currency)
  const lines: string[] = []
  lines.push(`${project.emoji} ${project.name}（${project.date}）`)
  lines.push(`總計 ${fmt(result.grandTotalRounded)}${result.baseGrandTotal != null ? ` ≈ ${fmtMoney(result.baseGrandTotal, baseCurrency)}` : ''}`)
  const payer = project.people.find((p) => p.id === project.payerId)
  if (result.multiPayer) {
    const payers = result.people.filter((r) => r.paid > 0).map((r) => `${r.person.emoji}${r.person.name} ${fmt(r.paid)}`)
    lines.push(`先付：${payers.join('、')}`)
  } else if (payer) lines.push(`由 ${payer.emoji}${payer.name} 代墊`)
  lines.push('')
  const name = (id: string) => {
    const x = project.people.find((p) => p.id === id)
    return x ? `${x.emoji} ${x.name}` : '？'
  }
  if (result.multiPayer) {
    for (const r of result.people) lines.push(`${r.person.emoji} ${r.person.name}：應付 ${fmt(r.totalRounded)}`)
    lines.push('')
    lines.push('💸 誰轉給誰')
    for (const t of result.transfers) {
      const base = t.baseAmount != null ? ` ≈ ${fmtMoney(t.baseAmount, baseCurrency)}` : ''
      lines.push(`${name(t.from)} → ${name(t.to)}：${fmt(t.amount)}${base}${t.settled ? ' ✅' : ''}`)
    }
  } else {
    for (const r of result.people) {
      const tag = r.isPayer ? '（代墊）' : r.settled ? ' ✅' : ''
      const base = r.baseTotal != null ? ` ≈ ${fmtMoney(r.baseTotal, baseCurrency)}` : ''
      lines.push(`${r.person.emoji} ${r.person.name}：${fmt(r.totalRounded)}${base}${tag}`)
    }
  }
  lines.push('')
  lines.push(`— 반반 BanBan 半半分帳 ${cur.flag}`)
  return lines.join('\n')
}

export function fmtMoney(n: number, currency: string, opts: { compact?: boolean } = {}) {
  const meta = currencyMeta(currency)
  const decimals = opts.compact ? Math.min(meta.decimals, 2) : meta.decimals
  const abs = Math.abs(n)
  const num = abs.toLocaleString('zh-TW', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  const symbol = currencySymbol(currency)
  return `${n < 0 ? '-' : ''}${symbol}${num}`
}

export function currencySymbol(code: string) {
  switch (code) {
    case 'TWD':
      return 'NT$'
    case 'JPY':
      return '¥'
    case 'KRW':
      return '₩'
    case 'USD':
      return '$'
    case 'EUR':
      return '€'
    case 'GBP':
      return '£'
    case 'HKD':
      return 'HK$'
    case 'CNY':
      return '¥'
    case 'THB':
      return '฿'
    case 'SGD':
      return 'S$'
    case 'VND':
      return '₫'
    case 'PHP':
      return '₱'
    case 'IDR':
      return 'Rp'
    case 'AUD':
      return 'A$'
    case 'CAD':
      return 'C$'
    case 'NZD':
      return 'NZ$'
    case 'MYR':
      return 'RM'
    case 'CHF':
      return 'CHF '
    default:
      return code + ' '
  }
}
