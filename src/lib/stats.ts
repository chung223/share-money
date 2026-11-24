/** 月報表：這個月我幫大家代墊了多少、各分類佔多少、誰欠最多。純計算，沒有畫面。 */
import { meIdIn } from './balances'
import { guessCategory, type Category } from './category'
import { computeSplit } from './split'
import type { Id, Person, Project, Trip } from './types'

export interface CategoryStat {
  id: Category
  total: number
  count: number
}
export interface FriendStat {
  person: Person
  /** 這個月他在所有帳本欠我的總額 */
  total: number
  /** 其中還沒還的 */
  remaining: number
  count: number
}
export interface MonthStats {
  month: string
  /** 當月代墊總額（別人欠我的原始金額，主要幣別） */
  total: number
  /** 還沒收回的 */
  remaining: number
  /** 有代墊的帳本數 */
  projectCount: number
  /** 依金額大到小，只列有金額的分類 */
  categories: CategoryStat[]
  /** 未還多的在前 */
  friends: FriendStat[]
  /** 外幣沒換算、沒算進去的筆數 */
  foreignCount: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** '2026-09-03' -> '2026-09'；格式不對回空字串。 */
export function monthKey(date: string): string {
  return /^\d{4}-(0[1-9]|1[0-2])/.test(date) ? date.slice(0, 7) : ''
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const t = y * 12 + (m - 1) + delta
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** 可以切換的月份範圍：最早帳本到最晚帳本，且一定包含今天所在的月份。 */
export function monthRange(projects: Project[], today: string): { min: string; max: string } {
  const now = monthKey(today)
  let min = now
  let max = now
  for (const p of projects) {
    const k = monthKey(p.date)
    if (!k) continue
    if (k < min) min = k
    if (k > max) max = k
  }
  return { min, max }
}

export function monthStats(projects: Project[], meId: Id, base: string, month: string, trips: Trip[] = []): MonthStats {
  const cats = new Map<Category, CategoryStat>()
  const friends = new Map<Id, FriendStat>()
  let total = 0
  let remaining = 0
  let projectCount = 0
  let foreignCount = 0
  for (const p of projects) {
    if (monthKey(p.date) !== month) continue
    const me = meIdIn(p, meId, trips)
    if (!me) continue
    const mine = computeSplit(p, base).transfers.filter((t) => t.to === me && t.from !== me)
    const c = guessCategory(p)
    let counted = false
    for (const t of mine) {
      if (t.dueCurrency !== base) {
        foreignCount++
        continue
      }
      const person = p.people.find((x) => x.id === t.from)
      if (!person) continue
      counted = true
      const left = t.settled ? 0 : t.remaining
      total += t.due
      remaining += left
      const cs = cats.get(c) ?? { id: c, total: 0, count: 0 }
      cs.total += t.due
      cats.set(c, cs)
      const f = friends.get(person.id) ?? { person, total: 0, remaining: 0, count: 0 }
      f.total += t.due
      f.remaining += left
      f.count++
      friends.set(person.id, f)
    }
    if (counted) {
      projectCount++
      cats.get(c)!.count++
    }
  }
  return {
    month,
    total: round2(total),
    remaining: round2(remaining),
    projectCount,
    categories: [...cats.values()].map((c) => ({ ...c, total: round2(c.total) })).sort((a, b) => b.total - a.total),
    friends: [...friends.values()].map((f) => ({ ...f, total: round2(f.total), remaining: round2(f.remaining) })).sort((a, b) => b.remaining - a.remaining || b.total - a.total),
    foreignCount,
  }
}
