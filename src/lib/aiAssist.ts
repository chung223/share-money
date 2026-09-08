/**
 * 三個 AI 小幫手的提示詞與結果正規化（純函式、可測）：
 *  1. draftFromText：一句話 → 帳本草稿（人、品項、分法、代墊者）
 *  2. assignItems：品項 → 誰吃 / 主餐或共享
 *  3. reminderPrompt：催款訊息
 * 呼叫模型的部分由呼叫端做（aiChat），這裡只管 in/out。
 */
import { CATEGORIES, type Category } from './category'
import { firstJsonObject } from './receiptAi'
import type { Item, Person, Project, SplitMode } from './types'

export interface DraftPerson {
  name: string
  /** 對到既有的 me / friends 就填 id，否則新建 */
  id?: string
}
export interface DraftItem {
  name: string
  qty: number
  price: number
  sharedBy: 'all' | string[] // person names
  kind: 'main' | 'shared'
}
export interface ProjectDraft {
  name: string
  emoji: string
  category: Category
  date: string | null
  currency: string
  mode: SplitMode
  people: DraftPerson[]
  payer: string // person name
  payments?: { name: string; amount: number }[]
  items: DraftItem[]
  extras: { name: string; amount: number; type: 'fixed' | 'percent' }[]
  note?: string
}

export function draftSystem(ctx: { meName: string; friendNames: string[]; baseCurrency: string; today: string }) {
  return `你是分帳小幫手。使用者用一句話描述一次消費，請整理成 JSON（只輸出 JSON）：
{"name":"帳本名稱","emoji":"一個表情符號","category":"food|transport|shopping|travel|fun|other","date":"YYYY-MM-DD或null","currency":"ISO代碼","mode":"equal|items|mains","people":["名字",...],"payer":"先付錢的人名字","payments":[{"name":"名字","amount":金額}]或省略,"items":[{"name":"品名","qty":數量,"price":單價,"sharedBy":"all"或["名字"],"kind":"main|shared"}],"extras":[{"name":"服務費/外送費/折扣","amount":數值,"type":"fixed|percent"}],"note":"補充或null"}
規則：
- 使用者本人叫「${ctx.meName}」，句子裡的「我」就是 ${ctx.meName}，一定要放進 people。
- 已知的朋友：${ctx.friendNames.length ? ctx.friendNames.join('、') : '（沒有）'}。名字對得上就用同樣的寫法。
- 「我付的」「我先付」→ payer 是 ${ctx.meName}。多人先付才填 payments，總和要等於總額。
- 只講總額、大家平分 → mode "equal"，items 放一筆 {"name":"總額","price":總額,"qty":1,"sharedBy":"all","kind":"shared"}。
- 有講到誰吃什麼 → mode "items"，每項 sharedBy 填名字陣列；沒指定的填 "all"。
- 「主餐各付、小菜共享」這種 → mode "mains"，主餐 kind "main" 並指定一人，共享 kind "shared" sharedBy "all"。
- 幣別預設 ${ctx.baseCurrency}；出現日圓／韓元／美金等才改。今天是 ${ctx.today}，「昨天」「上週五」請換算。
- 服務費 10% → extras {"name":"服務費","amount":10,"type":"percent"}；折扣為負數 fixed。
- 資訊不足時給合理預設，不要問問題。`
}

export function normaliseDraft(raw: string, ctx: { me: Person; friends: Person[]; baseCurrency: string; today: string }): ProjectDraft {
  const jt = firstJsonObject(raw.replace(/<think>[\s\S]*?<\/think>/g, ''))
  if (!jt) throw new Error('AI 沒有回傳 JSON')
  const j = JSON.parse(jt) as Record<string, unknown>
  const str = (v: unknown, d = '') => (typeof v === 'string' ? v.trim() : d)
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : d)
  const known = [ctx.me, ...ctx.friends]
  const resolve = (name: string): DraftPerson => {
    const n = name.trim()
    if (!n) return { name: '？' }
    if (n === '我' || n === ctx.me.name) return { name: ctx.me.name, id: ctx.me.id }
    const hit = known.find((p) => p.name === n) ?? known.find((p) => p.name.toLowerCase() === n.toLowerCase())
    return hit ? { name: hit.name, id: hit.id } : { name: n.slice(0, 20) }
  }
  const rawPeople = Array.isArray(j.people) ? (j.people as unknown[]).map((x) => str(x)).filter(Boolean) : []
  const people: DraftPerson[] = []
  for (const n of rawPeople) {
    const p = resolve(n)
    if (!people.some((x) => x.name === p.name)) people.push(p)
  }
  if (!people.some((p) => p.id === ctx.me.id)) people.unshift({ name: ctx.me.name, id: ctx.me.id })
  const nameOf = (v: unknown) => resolve(str(v)).name
  const payer = people.some((p) => p.name === nameOf(j.payer)) ? nameOf(j.payer) : ctx.me.name
  const catId = str(j.category) as Category
  const category: Category = CATEGORIES.some((c) => c.id === catId) ? catId : 'food'
  const modeRaw = str(j.mode)
  const mode: SplitMode = modeRaw === 'items' || modeRaw === 'mains' ? modeRaw : 'equal'
  const items: DraftItem[] = (Array.isArray(j.items) ? (j.items as Record<string, unknown>[]) : [])
    .map((it) => {
      const sb = it.sharedBy
      const sharedBy: 'all' | string[] = Array.isArray(sb) ? sb.map((x) => nameOf(x)).filter((n) => people.some((p) => p.name === n)) : 'all'
      return { name: str(it.name, '項目').slice(0, 60), qty: Math.max(1, Math.round(num(it.qty, 1))), price: num(it.price), sharedBy: Array.isArray(sharedBy) && sharedBy.length === 0 ? 'all' : sharedBy, kind: str(it.kind) === 'main' ? 'main' : 'shared' } as DraftItem
    })
    .filter((it) => it.price !== 0)
  const extras = (Array.isArray(j.extras) ? (j.extras as Record<string, unknown>[]) : [])
    .map((e) => ({ name: str(e.name, '額外').slice(0, 40), amount: num(e.amount), type: str(e.type) === 'percent' ? ('percent' as const) : ('fixed' as const) }))
    .filter((e) => e.amount !== 0)
  const payments = Array.isArray(j.payments)
    ? (j.payments as Record<string, unknown>[]).map((p) => ({ name: nameOf(p.name), amount: num(p.amount) })).filter((p) => p.amount > 0 && people.some((x) => x.name === p.name))
    : undefined
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(j.date)) ? str(j.date) : null
  const currency = /^[A-Z]{3}$/.test(str(j.currency)) ? str(j.currency) : ctx.baseCurrency
  const emoji = str(j.emoji) || CATEGORIES.find((c) => c.id === category)!.emojis[0]
  return { name: str(j.name).slice(0, 40), emoji: [...emoji][0] ?? '🧾', category, date, currency, mode, people, payer, payments: payments && payments.length > 1 ? payments : undefined, items, extras, note: str(j.note) || undefined }
}

/** 把草稿套進一個新帳本。回傳需要新增到常用朋友的人。 */
export function applyDraft(p: Project, d: ProjectDraft, ctx: { me: Person; friends: Person[]; newPerson: (name: string, i: number) => Person }): Person[] {
  const created: Person[] = []
  const persons = new Map<string, Person>()
  d.people.forEach((dp, i) => {
    const existing = dp.id ? [ctx.me, ...ctx.friends].find((x) => x.id === dp.id) : undefined
    const person = existing ?? ctx.newPerson(dp.name, ctx.friends.length + i)
    if (!existing) created.push(person)
    persons.set(dp.name, person)
  })
  p.name = d.name
  p.emoji = d.emoji
  p.category = d.category
  if (d.date) p.date = d.date
  p.currency = d.currency
  p.mode = d.mode
  p.people = [...persons.values()]
  p.payerId = persons.get(d.payer)?.id ?? ctx.me.id
  p.payments = d.payments?.map((x) => ({ personId: persons.get(x.name)!.id, amount: x.amount })).filter((x) => x.personId)
  p.items = d.items.map((it, i) => ({ id: `ai${Date.now().toString(36)}${i}`, name: it.name, qty: it.qty, price: it.price, sharedBy: it.sharedBy === 'all' ? 'all' : it.sharedBy.map((n) => persons.get(n)!.id).filter(Boolean), kind: it.kind }))
  p.extras = d.extras.map((e, i) => ({ id: `ax${Date.now().toString(36)}${i}`, name: e.name, emoji: e.amount < 0 ? '🏷️' : e.type === 'percent' ? '🧂' : '🛵', type: e.type, value: e.amount, split: 'proportional' }))
  if (d.note) p.note = d.note
  return created
}

// ---------- 2. 分配品項 ----------

export function assignSystem(people: string[], mode: SplitMode) {
  return `你是分帳小幫手。給你一張帳單的品項和在場的人，請判斷每個品項是誰的。只輸出 JSON：
{"items":[{"i":索引,"sharedBy":"all"或["名字"],"kind":"main|shared"}]}
在場的人：${people.join('、')}。
規則：
- ${mode === 'mains' ? '主餐（麵、飯、定食、排餐、單人份主食）kind 是 "main" 並指定一個人；小菜、飲料、共享的 kind "shared"、sharedBy "all"。' : '知道誰點的就填名字陣列，看不出來就 "all"。'}
- 使用者可能在補充說明裡指定「牛肉麵是小明的」，以說明為準。
- 每個索引都要回覆。`
}

export function normaliseAssign(raw: string, items: Item[], people: Person[]): Partial<Pick<Item, 'sharedBy' | 'kind'>>[] {
  const jt = firstJsonObject(raw.replace(/<think>[\s\S]*?<\/think>/g, ''))
  if (!jt) throw new Error('AI 沒有回傳 JSON')
  const j = JSON.parse(jt) as { items?: { i?: number; sharedBy?: unknown; kind?: unknown }[] }
  const out: Partial<Pick<Item, 'sharedBy' | 'kind'>>[] = items.map(() => ({}))
  for (const row of j.items ?? []) {
    const i = typeof row.i === 'number' ? row.i : -1
    if (i < 0 || i >= items.length) continue
    const ids = Array.isArray(row.sharedBy) ? (row.sharedBy as unknown[]).map((n) => people.find((p) => p.name === String(n).trim())?.id).filter((x): x is string => !!x) : []
    out[i] = { sharedBy: ids.length ? ids : 'all', kind: row.kind === 'main' && ids.length === 1 ? 'main' : 'shared' }
  }
  return out
}

// ---------- 3. 催款 ----------

export function reminderSystem() {
  return `你是幫使用者寫催款訊息的朋友，語氣自然、口語、繁體中文台灣用語，可以用 emoji 但別太多。只輸出訊息本文，不要引號、不要解釋。60 字以內，最後一定要把轉帳資訊照原樣附上（如果有給）。`
}
export function reminderUser(o: { toName: string; amountText: string; what: string; daysAgo: number; tone: string; payLines: string[]; relation?: string; link?: string | null }) {
  return [
    `對象：${o.toName}${o.relation ? `（${o.relation}）` : ''}`,
    `事由：${o.what}`,
    `金額：${o.amountText}`,
    `距今：${o.daysAgo} 天`,
    `語氣：${o.tone}`,
    o.payLines.length ? `轉帳資訊（照抄）：\n${o.payLines.join('\n')}` : '（沒有轉帳資訊）',
    o.link ? `明細連結（照抄在最後）：${o.link}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
