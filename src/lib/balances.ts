/** 跨帳本結算：同一個人在所有帳本裡欠我 / 我欠他的未還款加總（以主要幣別計），可互相抵銷。 */
import { computeSplit, type Transfer } from './split'
import type { Id, Person, Project } from './types'

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

export function personBalances(projects: Project[], meId: Id, base: string): PersonBalance[] {
  const map = new Map<Id, PersonBalance>()
  for (const p of projects) {
    if (!p.people.some((x) => x.id === meId)) continue
    const r = computeSplit(p, base)
    for (const t of r.transfers) {
      if (t.settled || t.remaining <= 0) continue
      if (t.to !== meId && t.from !== meId) continue
      const otherId = t.to === meId ? t.from : t.to
      const other = p.people.find((x) => x.id === otherId)
      if (!other) continue
      let b = map.get(otherId)
      if (!b) {
        b = { person: other, owesMe: 0, iOwe: 0, net: 0, lines: [], foreign: [] }
        map.set(otherId, b)
      }
      const signed = t.to === meId ? t.remaining : -t.remaining
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
