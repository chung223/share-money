/** 跨帳本結算：同一個人在所有帳本裡欠我 / 我欠他的未還款加總（以主要幣別計），可互相抵銷。 */
import { computeSplit, simplifyDebts, type Transfer } from './split'
import { currencyMeta } from './types'
import type { Id, Person, Project, Trip } from './types'

export interface BalanceLine {
  project: Project
  transfer: Transfer
  /** 正 = 對方要給我，負 = 我要給對方（due 幣別） */
  signed: number
  currency: string
}
export interface PersonBalance {
  person: Person
  /** 只加總主要幣別；外幣未換算的另外列在 foreign */
  owesMe: number
  iOwe: number
  net: number
  lines: BalanceLine[]
  foreign: BalanceLine[]
}

/** 在某本帳裡「我」是誰：自己的 me.id，或共編旅程裡我對應的人。 */
export function meIdIn(p: Project, meId: Id, trips: Trip[] = []): Id | null {
  if (p.people.some((x) => x.id === meId)) return meId
  const alias = p.tripId ? trips.find((t) => t.id === p.tripId)?.share?.myPersonId : undefined
  return alias && p.people.some((x) => x.id === alias) ? alias : null
}

export function personBalances(projects: Project[], meId: Id, base: string, trips: Trip[] = []): PersonBalance[] {
  const map = new Map<Id, PersonBalance>()
  for (const p of projects) {
    const me = meIdIn(p, meId, trips)
    if (!me) continue
    const r = computeSplit(p, base)
    for (const t of r.transfers) {
      if (t.settled || t.remaining <= 0) continue
      if (t.to !== me && t.from !== me) continue
      const otherId = t.to === me ? t.from : t.to
      const other = p.people.find((x) => x.id === otherId)
      if (!other) continue
      let b = map.get(otherId)
      if (!b) {
        b = { person: other, owesMe: 0, iOwe: 0, net: 0, lines: [], foreign: [] }
        map.set(otherId, b)
      }
      const signed = t.to === me ? t.remaining : -t.remaining
      const line: BalanceLine = { project: p, transfer: t, signed, currency: t.dueCurrency }
      if (t.dueCurrency === base) {
        b.lines.push(line)
        if (signed > 0) b.owesMe += signed
        else b.iOwe += -signed
      } else b.foreign.push(line)
    }
  }
  const out = [...map.values()]
  for (const b of out) {
    b.net = Math.round((b.owesMe - b.iOwe) * 100) / 100
    b.lines.sort((a, c) => c.project.date.localeCompare(a.project.date))
  }
  return out.sort((a, b) => b.net - a.net)
}

export interface TripSettlement {
  /** 建議轉帳（已互相抵銷、最少次數） */
  transfers: { from: Person; to: Person; amount: number }[]
  currency: string
  /** 每人淨額（正 = 該收） */
  nets: { person: Person; net: number; paid: number; owed: number }[]
  /** 未結清的原始轉帳（供「已轉」標記用） */
  open: { project: Project; transfer: Transfer }[]
  /** 外幣未換算、沒算進去的 */
  foreign: { project: Project; transfer: Transfer }[]
  people: Person[]
}

/** 一趟旅程所有帳本的未結清轉帳，合併成每人淨額再簡化。同名不同 id 的人視為不同人（共編時 id 一致）。 */
export function tripSettlement(projects: Project[], base: string): TripSettlement {
  const people = new Map<Id, Person>()
  const nets = new Map<Id, { net: number; paid: number; owed: number }>()
  const open: TripSettlement['open'] = []
  const foreign: TripSettlement['foreign'] = []
  const bump = (id: Id, d: Partial<{ net: number; paid: number; owed: number }>) => {
    const cur = nets.get(id) ?? { net: 0, paid: 0, owed: 0 }
    nets.set(id, { net: cur.net + (d.net ?? 0), paid: cur.paid + (d.paid ?? 0), owed: cur.owed + (d.owed ?? 0) })
  }
  for (const p of projects) {
    for (const x of p.people) if (!people.has(x.id)) people.set(x.id, x)
    const r = computeSplit(p, base)
    for (const t of r.transfers) {
      if (t.settled || t.remaining <= 0) continue
      if (t.dueCurrency !== base) {
        foreign.push({ project: p, transfer: t })
        continue
      }
      open.push({ project: p, transfer: t })
      bump(t.from, { net: -t.remaining, owed: t.remaining })
      bump(t.to, { net: t.remaining, paid: t.remaining })
    }
  }
  const decimals = currencyMeta(base).decimals
  const simplified = simplifyDebts([...nets.entries()].map(([id, v]) => ({ id, net: v.net })), decimals)
  return {
    currency: base,
    transfers: simplified.map((t) => ({ from: people.get(t.from)!, to: people.get(t.to)!, amount: t.amount })).filter((t) => t.from && t.to),
    nets: [...nets.entries()].map(([id, v]) => ({ person: people.get(id)!, ...v, net: Math.round(v.net * 100) / 100 })).filter((x) => x.person).sort((a, b) => b.net - a.net),
    open,
    foreign,
    people: [...people.values()],
  }
}
