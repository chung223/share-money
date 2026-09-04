/** LINE 訊息模板：Flex 卡片、Quick Reply、文字。純函式，方便測試。 */
import type { ParseOutput } from '../../src/lib/receiptAi.ts'

export const APP_URL = 'https://spilt.chung.men'
const money = (n: number, cur: string | null) => `${cur && cur !== 'TWD' ? cur + ' ' : 'NT$'}${n.toLocaleString('zh-TW')}`

export function quickReply(items: { label: string; data?: string; text?: string; uri?: string }[]) {
  return {
    items: items.slice(0, 13).map((i) => ({
      type: 'action',
      action: i.uri ? { type: 'uri', label: i.label, uri: i.uri } : i.data ? { type: 'postback', label: i.label, data: i.data, displayText: i.label } : { type: 'message', label: i.label, text: i.text ?? i.label },
    })),
  }
}

export function textMsg(text: string, qr?: ReturnType<typeof quickReply>) {
  return qr ? { type: 'text', text, quickReply: qr } : { type: 'text', text }
}

/** 收據解析結果卡片 */
export function receiptFlex(r: ParseOutput, draftId: number, pending: number) {
  const rows = r.items.slice(0, 8).map((it) => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: `${it.name}${it.qty > 1 ? ` ×${it.qty}` : ''}`, size: 'sm', color: '#3b2e2a', flex: 5, wrap: true },
      { type: 'text', text: money(it.price * it.qty, r.currency), size: 'sm', color: '#3b2e2a', align: 'end', flex: 3 },
    ],
  }))
  if (r.items.length > 8) rows.push({ type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: `…還有 ${r.items.length - 8} 項`, size: 'xs', color: '#9a8b85', flex: 1, wrap: true }, { type: 'text', text: '', size: 'xs', color: '#9a8b85', align: 'end', flex: 0 }] })
  for (const e of r.extras.slice(0, 4)) rows.push({ type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: e.name, size: 'xs', color: '#9a8b85', flex: 5, wrap: true }, { type: 'text', text: money(e.amount, r.currency), size: 'xs', color: '#9a8b85', align: 'end', flex: 3 }] })
  return {
    type: 'flex',
    altText: `收據辨識：${r.merchant ?? ''} ${r.items.length} 項${r.total != null ? ` 總計 ${money(r.total, r.currency)}` : ''}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#FFB3C6', contents: [{ type: 'text', text: `🧾 ${r.merchant ?? '收據'}`, weight: 'bold', color: '#3b2e2a', size: 'md' }, ...(r.date ? [{ type: 'text', text: r.date, size: 'xs', color: '#7a4a58' }] : [])] },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows.length ? rows : [{ type: 'text', text: '（沒有品項）', size: 'sm', color: '#9a8b85' }] },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          ...(r.total != null ? [{ type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: '總計', weight: 'bold', size: 'sm' }, { type: 'text', text: money(r.total, r.currency), weight: 'bold', size: 'sm', align: 'end' }] }] : []),
          { type: 'button', style: 'primary', color: '#FF8FAB', height: 'sm', action: { type: 'uri', label: `在 App 建帳本（收件匣 ${pending} 筆）`, uri: `${APP_URL}/#/inbox` } },
          { type: 'button', style: 'link', height: 'sm', action: { type: 'postback', label: '略過這張', data: `ack:${draftId}`, displayText: '略過這張收據' } },
        ],
      },
    },
  }
}

/** 一句話草稿的回覆 */
export function textDraftReply(text: string, draftId: number, pending: number) {
  return textMsg(`收到：「${text.slice(0, 60)}${text.length > 60 ? '…' : ''}」\n已放進收件匣（${pending} 筆）。打開 App 用 AI 一鍵變帳本 ✨`, quickReply([{ label: '✨ 去建帳本', uri: `${APP_URL}/#/inbox` }, { label: '略過這句', data: `ack:${draftId}` }]))
}

export interface SummaryItem {
  name: string
  amount: number
  currency: string
  projects: string[]
}
export interface Summary {
  items: SummaryItem[]
  total: number
  currency: string
  updatedAt: number
}

/** 「誰欠我」摘要卡 */
export function summaryFlex(s: Summary | null) {
  if (!s || !s.items.length) return textMsg(s ? '目前沒有人欠你 🎉' : '你還沒開「催款摘要同步」。到 App 設定頁 → LINE 機器人 打開，bot 才看得到誰欠你多少（只會同步名字和金額）。', quickReply([{ label: '開 App', uri: APP_URL }]))
  const rows = s.items.slice(0, 10).map((it) => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: it.name, size: 'sm', flex: 3, wrap: true },
      { type: 'text', text: it.projects.slice(0, 2).join('、') + (it.projects.length > 2 ? '…' : ''), size: 'xxs', color: '#9a8b85', flex: 4, wrap: true },
      { type: 'text', text: money(it.amount, it.currency), size: 'sm', weight: 'bold', align: 'end', flex: 3 },
    ],
  }))
  return {
    type: 'flex',
    altText: `還有 ${s.items.length} 人欠你，合計 ${money(s.total, s.currency)}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#B9EDD8', contents: [{ type: 'text', text: '💰 誰還欠我', weight: 'bold', size: 'md', color: '#1f7a5c' }, { type: 'text', text: `合計 ${money(s.total, s.currency)} · ${new Date(s.updatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新`, size: 'xs', color: '#1f7a5c' }] },
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: rows },
      footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#FF8FAB', height: 'sm', action: { type: 'uri', label: '去催款', uri: `${APP_URL}/#/balances` } }] },
    },
  }
}

export function weeklyText(s: Summary) {
  const lines = [`⏰ 週一提醒：還有 ${s.items.length} 人沒還你，合計 ${money(s.total, s.currency)}`]
  for (const it of s.items.slice(0, 8)) lines.push(`・${it.name} ${money(it.amount, it.currency)}`)
  if (s.items.length > 8) lines.push(`・…還有 ${s.items.length - 8} 人`)
  lines.push(`👉 ${APP_URL}/#/balances`)
  return lines.join('\n')
}

export function inboxText(n: number, drafts: { kind: string; payload: string }[]) {
  if (!n) return textMsg('收件匣是空的 📭 傳收據照片或一句話給我就會出現在這。', quickReply([{ label: '開 App', uri: APP_URL }]))
  const lines = drafts.slice(0, 5).map((d) => {
    try {
      const p = JSON.parse(d.payload)
      if (d.kind === 'text') return `💬 ${String(p.text).slice(0, 30)}`
      if (d.kind === 'receipt') return `🧾 ${p.receipt?.merchant ?? '收據'} ${p.receipt?.items?.length ?? 0} 項`
      return '🖼 圖片（待辨識）'
    } catch {
      return '？'
    }
  })
  return textMsg(`📥 收件匣 ${n} 筆：\n${lines.join('\n')}${n > 5 ? '\n…' : ''}`, quickReply([{ label: '去建帳本', uri: `${APP_URL}/#/inbox` }]))
}

export const HELP_QR = quickReply([{ label: '📥 收件匣', data: 'inbox' }, { label: '💰 誰欠我', data: 'balances' }, { label: '開 App', uri: APP_URL }])
