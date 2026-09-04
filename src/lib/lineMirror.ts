/**
 * LINE 等級 2：把帳本「結算結果」做成明文鏡像給 bot（不含品項、不含收款帳號以外的東西），
 * 以及把 bot 下的指令套回本地資料。與 server/src/lineMirror.ts 的型別一致。
 */
import { computeSplit } from './split'
import { payLines } from './reminder'
import { categoryOf } from './category'
import { meIdIn } from './balances'
import { shareUrl } from './share'
import type { AppData, Id } from './types'

export interface MirrorOut {
  v: 1
  me: { id: Id; name: string }
  baseCurrency: string
  payLines: string[]
  projects: {
    id: Id
    name: string
    emoji: string
    date: string
    category: string
    currency: string
    total: number
    baseTotal: number | null
    tripId?: Id
    /** 有效的分享連結（含金鑰）；bot 卡片用它做「傳給 LINE 好友」 */
    shareUrl?: string
    payers: Id[]
    people: { id: Id; name: string; amount: number }[]
    transfers: { from: Id; to: Id; amount: number; currency: string; remaining: number; paid: number; settled: boolean }[]
  }[]
  trips: { id: Id; name: string; emoji: string }[]
}

export function buildMirror(d: AppData, limit = 60): MirrorOut {
  const projects = [...d.projects]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((p) => {
      const r = computeSplit(p, d.baseCurrency)
      const me = meIdIn(p, d.me.id, d.trips ?? [])
      return {
        id: p.id,
        name: p.name,
        emoji: p.emoji,
        date: p.date,
        category: categoryOf(p).id,
        currency: p.currency,
        total: r.grandTotalRounded,
        baseTotal: r.baseGrandTotal,
        tripId: p.tripId,
        shareUrl: p.share && p.share.expiresAt > Date.now() ? shareUrl(p.share.id, p.share.key, 'https://spilt.chung.men') : undefined,
        payers: r.multiPayer ? r.people.filter((x) => x.paid > 0).map((x) => x.person.id) : [p.payerId],
        // 共編旅程裡「我」可能是別的 id：把它對映成 me.id，bot 端才知道哪些是「欠我」
        people: r.people.map((x) => ({ id: x.person.id === me && me !== d.me.id ? d.me.id : x.person.id, name: x.person.name, amount: x.totalRounded })),
        transfers: r.transfers.map((t) => ({ from: t.from === me && me !== d.me.id ? d.me.id : t.from, to: t.to === me && me !== d.me.id ? d.me.id : t.to, amount: t.amount, currency: t.dueCurrency, remaining: t.remaining, paid: t.paid, settled: t.settled })),
      }
    })
  return { v: 1, me: { id: d.me.id, name: d.me.name }, baseCurrency: d.baseCurrency, payLines: payLines(d.payInfo), projects, trips: (d.trips ?? []).map((t) => ({ id: t.id, name: t.name, emoji: t.emoji })) }
}

export type LineCommandIn = { id: number; createdAt: number } & (
  | { type: 'settle'; personId: Id; personName: string; amount?: number; projectId?: Id }
  | { type: 'addPerson'; projectId: Id; personName: string }
  | { type: 'deleteProject'; projectId: Id }
)

export interface ApplyResult {
  applied: number
  notes: string[]
}

/** 套用 bot 指令。呼叫端負責存檔與同步；回傳套用了幾個與說明。 */
export function applyLineCommands(d: AppData, cmds: LineCommandIn[], newPerson: (name: string, i: number) => AppData['friends'][number]): ApplyResult {
  let applied = 0
  const notes: string[] = []
  for (const c of cmds) {
    if (c.type === 'deleteProject') {
      const i = d.projects.findIndex((p) => p.id === c.projectId)
      if (i >= 0) {
        const [p] = d.projects.splice(i, 1)
        d.deleted = { ...(d.deleted ?? {}), [p.id]: Date.now() }
        applied++
        notes.push(`刪除了 ${p.emoji} ${p.name || '未命名'}`)
      }
      continue
    }
    if (c.type === 'addPerson') {
      const p = d.projects.find((x) => x.id === c.projectId)
      if (!p) continue
      const existing = d.friends.find((f) => f.name === c.personName)
      const person = existing ?? newPerson(c.personName, d.friends.length)
      if (!existing) d.friends.push(person)
      if (!p.people.some((x) => x.id === person.id)) {
        p.people.push(person)
        p.updatedAt = Date.now()
        applied++
        notes.push(`${p.emoji} ${p.name || '未命名'} 加了 ${person.name}`)
      }
      continue
    }
    if (c.type === 'settle') {
      const targets = d.projects
        .filter((p) => !c.projectId || p.id === c.projectId)
        .sort((a, b) => b.date.localeCompare(a.date))
      let done = 0
      for (const p of targets) {
        const me = meIdIn(p, d.me.id, d.trips ?? [])
        if (!me) continue
        const r = computeSplit(p, d.baseCurrency)
        for (const t of r.transfers) {
          if (t.settled || t.from !== c.personId || t.to !== me) continue
          if (c.amount != null) {
            const paid = Math.min(t.due, Math.round((t.paid + c.amount) * 100) / 100)
            p.partial = { ...(p.partial ?? {}), [t.key]: paid }
            p.settled[t.key] = paid >= t.due
          } else p.settled[t.key] = true
          if (t.to === p.payerId) delete p.settled[t.from]
          p.updatedAt = Date.now()
          done++
          if (c.amount != null) break
        }
        if (c.amount != null && done) break
      }
      if (done) {
        applied++
        notes.push(c.amount != null ? `${c.personName} 還了 ${c.amount}` : `${c.personName} 的 ${done} 筆標為已還`)
      }
    }
  }
  return { applied, notes }
}
