/**
 * 等級 2：App 同步時上傳的明文鏡像（帳本結算結果，不含品項與帳號），bot 用它回答查詢、解析指令。
 * 型別與 App 端 src/lib/lineMirror.ts 一致。
 */
import { quickReply, textMsg, APP_URL } from './lineMessages.ts'

export interface MirrorTransfer {
  from: string
  to: string
  amount: number
  currency: string
  remaining: number
  paid: number
  settled: boolean
}
export interface MirrorProject {
  id: string
  name: string
  emoji: string
  date: string
  category: string
  currency: string
  total: number
  baseTotal: number | null
  tripId?: string
  payers: string[]
  people: { id: string; name: string; amount: number }[]
  transfers: MirrorTransfer[]
}
export interface Mirror {
  v: 1
  me: { id: string; name: string }
  baseCurrency: string
  payLines: string[]
  projects: MirrorProject[]
  trips: { id: string; name: string; emoji: string }[]
  updatedAt: number
}

/** 同 src/lib/split.ts 的貪婪債務簡化（伺服器不能直接 import 那個檔：它的相對匯入沒副檔名）。 */
export function simplifyDebts(nets: { id: string; net: number }[], decimals: number): { from: string; to: string; amount: number }[] {
  const f = 10 ** decimals
  const unit = 1 / f
  const creditors = nets.filter((x) => x.net > unit / 2).map((x) => ({ id: x.id, left: Math.round(x.net * f) }))
  const debtors = nets.filter((x) => x.net < -unit / 2).map((x) => ({ id: x.id, left: Math.round(-x.net * f) }))
  const out: { from: string; to: string; amount: number }[] = []
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

export function sanitizeMirror(raw: unknown, now: number): Mirror | null {
  const j = raw as Partial<Mirror>
  if (!j || typeof j !== 'object' || !j.me || !Array.isArray(j.projects)) return null
  const str = (v: unknown, n = 40) => String(v ?? '').slice(0, n)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
  const projects: MirrorProject[] = (j.projects as Partial<MirrorProject>[]).slice(0, 80).map((p) => ({
    id: str(p.id, 64),
    name: str(p.name),
    emoji: str(p.emoji, 4),
    date: str(p.date, 10),
    category: str(p.category, 12),
    currency: /^[A-Z]{3}$/.test(String(p.currency)) ? String(p.currency) : 'TWD',
    total: num(p.total),
    baseTotal: p.baseTotal == null ? null : num(p.baseTotal),
    tripId: p.tripId ? str(p.tripId, 64) : undefined,
    payers: Array.isArray(p.payers) ? p.payers.slice(0, 10).map((x) => str(x)) : [],
    people: Array.isArray(p.people) ? p.people.slice(0, 30).map((x) => ({ id: str(x?.id, 64), name: str(x?.name), amount: num(x?.amount) })) : [],
    transfers: Array.isArray(p.transfers) ? p.transfers.slice(0, 60).map((t) => ({ from: str(t?.from, 64), to: str(t?.to, 64), amount: num(t?.amount), currency: /^[A-Z]{3}$/.test(String(t?.currency)) ? String(t?.currency) : 'TWD', remaining: num(t?.remaining), paid: num(t?.paid), settled: !!t?.settled })) : [],
  }))
  return {
    v: 1,
    me: { id: str(j.me.id, 64), name: str(j.me.name) },
    baseCurrency: /^[A-Z]{3}$/.test(String(j.baseCurrency)) ? String(j.baseCurrency) : 'TWD',
    payLines: Array.isArray(j.payLines) ? j.payLines.slice(0, 5).map((x) => str(x, 80)) : [],
    projects,
    trips: Array.isArray(j.trips) ? j.trips.slice(0, 30).map((t) => ({ id: str(t?.id, 64), name: str(t?.name), emoji: str(t?.emoji, 4) })) : [],
    updatedAt: now,
  }
}

export const money = (n: number, cur: string) => `${cur === 'TWD' ? 'NT$' : cur + ' '}${Math.round(n * 100) / 100 !== Math.round(n) ? n.toFixed(2) : Math.round(n).toLocaleString('zh-TW')}`

function norm(s: string) {
  return s.replace(/\s+/g, '').toLowerCase()
}
/** 名字比對：完全相同 > 包含 */
export function findPerson(m: Mirror, q: string) {
  const n = norm(q)
  if (!n) return null
  const all = new Map<string, string>()
  for (const p of m.projects) for (const x of p.people) all.set(x.id, x.name)
  const entries = [...all.entries()]
  return entries.find(([, name]) => norm(name) === n) ?? entries.find(([, name]) => norm(name).includes(n) || n.includes(norm(name))) ?? null
}
export function findProject(m: Mirror, q: string) {
  const n = norm(q)
  if (!n) return null
  const sorted = [...m.projects].sort((a, b) => b.date.localeCompare(a.date))
  return sorted.find((p) => norm(p.name) === n) ?? sorted.find((p) => norm(p.name).includes(n) || (norm(p.name) && n.includes(norm(p.name)))) ?? null
}
export function findTrip(m: Mirror, q: string) {
  const n = norm(q)
  return m.trips.find((t) => norm(t.name) === n) ?? m.trips.find((t) => norm(t.name).includes(n)) ?? null
}
const nameOf = (p: MirrorProject, id: string) => p.people.find((x) => x.id === id)?.name ?? '？'

// ---------- 卡片 ----------

export function projectFlex(m: Mirror, p: MirrorProject) {
  const rows = p.people.slice(0, 10).map((x) => {
    const t = p.transfers.find((tr) => tr.from === x.id)
    const status = p.payers.includes(x.id) && !t ? '⭐' : !t ? '' : t.settled ? '✅' : t.paid > 0 ? `差 ${money(t.remaining, t.currency)}` : '⏳'
    return { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: x.name, size: 'sm', flex: 4, wrap: true }, { type: 'text', text: money(x.amount, p.currency), size: 'sm', align: 'end', flex: 3 }, { type: 'text', text: status, size: 'xs', color: '#9a8b85', align: 'end', flex: 3 }] }
  })
  const open = p.transfers.filter((t) => !t.settled)
  return {
    type: 'flex',
    altText: `${p.emoji} ${p.name}：${money(p.total, p.currency)}，${p.transfers.length - open.length}/${p.transfers.length} 已還`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#FFE9A8', contents: [{ type: 'text', text: `${p.emoji} ${p.name || '未命名'}`, weight: 'bold', size: 'md', color: '#3b2e2a', wrap: true }, { type: 'text', text: `${p.date} · ${money(p.total, p.currency)}${p.baseTotal != null && p.currency !== m.baseCurrency ? ` ≈ ${money(p.baseTotal, m.baseCurrency)}` : ''} · ${p.payers.map((id) => nameOf(p, id)).join('、')} 先付`, size: 'xs', color: '#7a5a05', wrap: true }] },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: open.length ? `還有 ${open.length} 筆沒還` : '全部結清 🎉', size: 'xs', color: '#9a8b85', align: 'center' },
          { type: 'button', style: 'primary', color: '#FF8FAB', height: 'sm', action: { type: 'uri', label: '在 App 打開', uri: `${APP_URL}/#/p/${p.id}/result` } },
        ],
      },
    },
  }
}

export function recentFlex(m: Mirror) {
  const list = [...m.projects].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
  if (!list.length) return textMsg('還沒有帳本。傳收據或一句話給我就能開一本！')
  const bubbles = list.map((p) => {
    const open = p.transfers.filter((t) => !t.settled).length
    return {
      type: 'bubble',
      size: 'micro',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        contents: [
          { type: 'text', text: `${p.emoji} ${p.name || '未命名'}`, weight: 'bold', size: 'sm', wrap: true },
          { type: 'text', text: p.date, size: 'xxs', color: '#9a8b85' },
          { type: 'text', text: money(p.total, p.currency), size: 'md', weight: 'bold', color: '#b8365a' },
          { type: 'text', text: open ? `⏳ ${open} 筆未還` : '✅ 結清', size: 'xxs', color: '#9a8b85' },
        ],
        action: { type: 'postback', data: `p:${p.id}`, displayText: `${p.emoji} ${p.name}` },
      },
    }
  })
  return { type: 'flex', altText: `最近 ${list.length} 本帳`, contents: { type: 'carousel', contents: bubbles } }
}

export function personFlex(m: Mirror, personId: string, name: string) {
  const owes: { p: MirrorProject; t: MirrorTransfer }[] = []
  const owed: { p: MirrorProject; t: MirrorTransfer }[] = []
  for (const p of m.projects) for (const t of p.transfers) {
    if (t.settled) continue
    if (t.from === personId && t.to === m.me.id) owes.push({ p, t })
    if (t.to === personId && t.from === m.me.id) owed.push({ p, t })
  }
  const sum = (l: typeof owes) => l.reduce((a, x) => a + x.t.remaining, 0)
  const rows = [...owes.map(({ p, t }) => ({ type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: `${p.emoji} ${p.name || '未命名'} ${p.date.slice(5)}`, size: 'sm', flex: 5, wrap: true }, { type: 'text', text: money(t.remaining, t.currency), size: 'sm', align: 'end', flex: 3 }] })), ...owed.map(({ p, t }) => ({ type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: `我欠 · ${p.emoji} ${p.name || '未命名'}`, size: 'sm', color: '#9a8b85', flex: 5, wrap: true }, { type: 'text', text: `−${money(t.remaining, t.currency)}`, size: 'sm', color: '#9a8b85', align: 'end', flex: 3 }] }))].slice(0, 12)
  const net = sum(owes) - sum(owed)
  const cur = owes[0]?.t.currency ?? owed[0]?.t.currency ?? m.baseCurrency
  return {
    type: 'flex',
    altText: `${name}：${net >= 0 ? '欠你' : '你欠他'} ${money(Math.abs(net), cur)}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: { type: 'box', layout: 'vertical', backgroundColor: net > 0 ? '#FFB3C6' : '#B9EDD8', contents: [{ type: 'text', text: `👤 ${name}`, weight: 'bold', size: 'md' }, { type: 'text', text: net > 0 ? `還欠你 ${money(net, cur)}` : net < 0 ? `你欠他 ${money(-net, cur)}` : '互不相欠 🎉', size: 'sm' }] },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows.length ? rows : [{ type: 'text', text: '沒有未結清的帳', size: 'sm', color: '#9a8b85' }] },
      footer: net > 0 ? { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [{ type: 'button', style: 'primary', color: '#FF8FAB', height: 'sm', action: { type: 'postback', label: '📣 催款文字', data: `remind:${personId}`, displayText: `催 ${name}` } }, { type: 'button', style: 'secondary', height: 'sm', action: { type: 'postback', label: '✅ 他還了', data: `settle:${personId}`, displayText: `${name}還了` } }] } : undefined,
    },
  }
}

export function tripFlex(m: Mirror, trip: { id: string; name: string; emoji: string }) {
  const projects = m.projects.filter((p) => p.tripId === trip.id)
  const nets = new Map<string, number>()
  const names = new Map<string, string>()
  let total = 0
  for (const p of projects) {
    for (const x of p.people) names.set(x.id, x.name)
    total += p.baseTotal ?? (p.currency === m.baseCurrency ? p.total : 0)
    for (const t of p.transfers) {
      if (t.settled || t.currency !== m.baseCurrency) continue
      nets.set(t.from, (nets.get(t.from) ?? 0) - t.remaining)
      nets.set(t.to, (nets.get(t.to) ?? 0) + t.remaining)
    }
  }
  const s = simplifyDebts([...nets.entries()].map(([id, net]) => ({ id, net })), 0)
  const rows = s.map((t) => ({ type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: `${names.get(t.from) ?? '？'} → ${names.get(t.to) ?? '？'}`, size: 'sm', flex: 5, wrap: true }, { type: 'text', text: money(t.amount, m.baseCurrency), size: 'sm', weight: 'bold', align: 'end', flex: 3 }] }))
  return {
    type: 'flex',
    altText: `${trip.emoji} ${trip.name}：${projects.length} 本帳，${s.length ? `${s.length} 筆轉帳結清` : '已結清'}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#D9D4F7', contents: [{ type: 'text', text: `🧳 ${trip.name}`, weight: 'bold', size: 'md' }, { type: 'text', text: `${projects.length} 本帳 · 共 ${money(total, m.baseCurrency)}`, size: 'xs', color: '#4a3d99' }] },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [{ type: 'text', text: '💸 最少轉帳', weight: 'bold', size: 'sm' }, ...(rows.length ? rows : [{ type: 'text', text: '全部結清 🎉', size: 'sm', color: '#9a8b85' }])] },
      footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#FF8FAB', height: 'sm', action: { type: 'uri', label: '在 App 打開', uri: `${APP_URL}/#/t/${trip.id}` } }] },
    },
  }
}

export function reminderTextFor(m: Mirror, personId: string, name: string) {
  const items: string[] = []
  let sum = 0
  let cur = m.baseCurrency
  for (const p of [...m.projects].sort((a, b) => b.date.localeCompare(a.date))) for (const t of p.transfers) {
    if (t.settled || t.from !== personId || t.to !== m.me.id) continue
    items.push(`・${p.date.slice(5).replace('-', '/')} ${p.emoji}${p.name || ''} ${money(t.remaining, t.currency)}`)
    sum += t.remaining
    cur = t.currency
  }
  if (!items.length) return `${name} 沒有欠你的帳 🎉`
  return [`${name}～ 幫你整理了一下，總共還有 ${money(sum, cur)}：`, ...items, ...(m.payLines.length ? ['轉這裡就好：', ...m.payLines] : []), `— 반반 BanBan`].join('\n')
}

// ---------- 指令 ----------
export type LineCommand =
  | { type: 'settle'; personId: string; personName: string; amount?: number; projectId?: string }
  | { type: 'addPerson'; projectId: string; personName: string }
  | { type: 'deleteProject'; projectId: string }

/** 解析一句指令；回 null 表示不是指令 */
export function parseCommand(m: Mirror, text: string): { cmd: LineCommand; confirm?: boolean; reply: string } | { error: string } | null {
  const t = text.trim()
  let mm = /^(.+?)\s*還了\s*(\d+(?:\.\d+)?)?\s*(?:元|塊)?$/.exec(t)
  if (mm) {
    const found = findPerson(m, mm[1])
    if (!found) return { error: `找不到叫「${mm[1]}」的人。` }
    const [personId, personName] = found
    const amount = mm[2] ? Number(mm[2]) : undefined
    const open = m.projects.flatMap((p) => p.transfers.filter((x) => !x.settled && x.from === personId && x.to === m.me.id).map((x) => ({ p, x })))
    if (!open.length) return { error: `${personName} 沒有欠你的帳。` }
    const projectId = amount ? open.sort((a, b) => b.p.date.localeCompare(a.p.date))[0].p.id : undefined
    return { cmd: { type: 'settle', personId, personName, amount, projectId }, reply: amount ? `記錄 ${personName} 還了 ${money(amount, open[0].x.currency)}（先抵最近一本）。App 下次同步就會更新。` : `把 ${personName} 的 ${open.length} 筆全部標為已還。App 下次同步就會更新。` }
  }
  mm = /^(.+?)\s*加\s*(.+)$/.exec(t)
  if (mm && !/^加/.test(t)) {
    const p = findProject(m, mm[1])
    if (!p) return { error: `找不到叫「${mm[1]}」的帳本。` }
    const personName = mm[2].trim().slice(0, 20)
    return { cmd: { type: 'addPerson', projectId: p.id, personName }, reply: `把「${personName}」加進 ${p.emoji} ${p.name}。` }
  }
  mm = /^(?:刪除|刪掉|删除)\s*(.+)$/.exec(t)
  if (mm) {
    const p = findProject(m, mm[1])
    if (!p) return { error: `找不到叫「${mm[1]}」的帳本。` }
    return { cmd: { type: 'deleteProject', projectId: p.id }, confirm: true, reply: `要刪除 ${p.emoji} ${p.name}（${p.date}，${money(p.total, p.currency)}）嗎？` }
  }
  return null
}

/** 小工具：平分、匯率 */
export async function utility(text: string, fetchFn: typeof fetch = fetch): Promise<ReturnType<typeof textMsg> | null> {
  const t = text.trim()
  let mm = /^(\d+(?:\.\d+)?)\s*(?:除|÷|\/|平分)\s*(\d+)(?:\s*人)?$/.exec(t)
  if (mm) {
    const total = Number(mm[1])
    const n = Number(mm[2])
    if (n > 0) {
      const each = total / n
      return textMsg(`${total} ÷ ${n} = 每人 ${Math.round(each * 100) / 100}${Number.isInteger(each) ? '' : `（進位 ${Math.ceil(each)}，差 ${Math.round((Math.ceil(each) * n - total) * 100) / 100}）`}`)
    }
  }
  const CUR: Record<string, string> = { 日圓: 'jpy', 日幣: 'jpy', 円: 'jpy', 韓元: 'krw', 韓幣: 'krw', 美金: 'usd', 美元: 'usd', 歐元: 'eur', 港幣: 'hkd', 人民幣: 'cny', 泰銖: 'thb', 新幣: 'sgd', 英鎊: 'gbp', 澳幣: 'aud' }
  mm = /^(日圓|日幣|円|韓元|韓幣|美金|美元|歐元|港幣|人民幣|泰銖|新幣|英鎊|澳幣)\s*(\d+(?:,\d{3})*(?:\.\d+)?)$|^(\d+(?:,\d{3})*(?:\.\d+)?)\s*(日圓|日幣|円|韓元|韓幣|美金|美元|歐元|港幣|人民幣|泰銖|新幣|英鎊|澳幣)$/.exec(t)
  if (mm) {
    const cur = CUR[mm[1] ?? mm[4]]
    const amt = Number((mm[2] ?? mm[3]).replace(/,/g, ''))
    try {
      const r = await fetchFn(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${cur}.min.json`)
      const j = (await r.json()) as Record<string, Record<string, number>>
      const rate = j[cur]?.twd
      if (rate) return textMsg(`${amt.toLocaleString('zh-TW')} ${cur.toUpperCase()} ≈ NT$${Math.round(amt * rate).toLocaleString('zh-TW')}（1 ${cur.toUpperCase()} = ${rate.toFixed(4)} TWD）`)
    } catch {
      /* fallthrough */
    }
    return textMsg('匯率暫時抓不到，等一下再試。')
  }
  return null
}

export const CMD_HELP = ['我看得懂這些：', '・最近帳本／某本帳的名字 → 結算卡片', '・某個人的名字 → 他欠你多少', '・旅程名字 → 整趟結算', '・「小明還了」「小明還了 200」→ 標已還', '・「拉麵聚 加小華」→ 帳本加人', '・「刪除 拉麵聚」→ 刪帳本（會再確認）', '・「900 除 3」「日圓 2400」→ 小算盤', '・傳收據照片或一句話 → 建帳本草稿'].join('\n')
export { quickReply }
