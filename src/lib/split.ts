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
  isPayer: boolean
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
      isPayer: p.id === project.payerId,
      settled: !!project.settled[p.id],
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

  return { people: results, itemsTotal, extrasTotal, grandTotal, grandTotalRounded, baseGrandTotal, unassigned }
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
  if (payer) lines.push(`由 ${payer.emoji}${payer.name} 代墊`)
  lines.push('')
  for (const r of result.people) {
    const tag = r.isPayer ? '（代墊）' : r.settled ? ' ✅' : ''
    const base = r.baseTotal != null ? ` ≈ ${fmtMoney(r.baseTotal, baseCurrency)}` : ''
    lines.push(`${r.person.emoji} ${r.person.name}：${fmt(r.totalRounded)}${base}${tag}`)
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
