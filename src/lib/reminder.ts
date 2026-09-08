/** 催款訊息：個人化文字 + 轉帳資訊，複製貼給對方就好。純函式，方便測試。 */
import type { PayInfo, Project } from './types'
import { fmtMoney, type PersonResult } from './split'

export type Tone = 'normal' | 'cute' | 'angry'
export const TONES: { value: Tone; label: string }[] = [
  { value: 'normal', label: '🙂 正常' },
  { value: 'cute', label: '🥺 可愛' },
  { value: 'angry', label: '😤 兇一點' },
]

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
export function fmtDateShort(date: string) {
  const d = new Date(date + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return date
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`
}

export function payLines(pay?: PayInfo): string[] {
  if (!pay) return []
  const out: string[] = []
  if (pay.account) out.push(`${[pay.bankCode, pay.bankName].filter(Boolean).join(' ')}${pay.bankCode || pay.bankName ? ' ' : ''}${pay.account}`.trim())
  if (pay.linePay) out.push(pay.linePay)
  if (pay.note) out.push(pay.note)
  return out
}

export interface ReminderInput {
  project: Project
  person: PersonResult
  /** Override the amount (multi-payer: what this person owes *you*). Defaults to their share. */
  amount?: number
  baseAmount?: number | null
  /** Fully formatted amount (e.g. remaining after a partial repayment); wins over amount/baseAmount. */
  amountText?: string
  baseCurrency: string
  payInfo?: PayInfo
  shareUrl?: string | null
  tone: Tone
}

export function reminderText({ project: p, person: r, amount, baseAmount, amountText, baseCurrency, payInfo, shareUrl, tone }: ReminderInput): string {
  const name = r.person.name
  const foreign = p.currency !== baseCurrency
  const a = amount ?? r.totalRounded
  const b = amount === undefined ? r.baseTotal : (baseAmount ?? null)
  const amt = amountText ?? fmtMoney(a, p.currency) + (foreign && b != null ? `（約 ${fmtMoney(b, baseCurrency)}）` : '')
  const what = `${fmtDateShort(p.date)} ${p.emoji}${p.name || '那次'}`
  const pay = payLines(payInfo)
  const lines: string[] = []
  if (tone === 'cute') {
    lines.push(`${name}～ 🥺 ${what}你的份是 ${amt}`)
    lines.push(pay.length ? `想到的時候轉一下就好，謝謝你 💕` : `想到的時候給我就好，謝謝你 💕`)
  } else if (tone === 'angry') {
    lines.push(`${name}！${what}的 ${amt} 還沒還喔 😤`)
    lines.push(pay.length ? `今天轉一下好嗎：` : `今天記得給我！`)
  } else {
    lines.push(`${name}～ ${what}你的部分是 ${amt}`)
    if (pay.length) lines.push(`轉這裡就好：`)
  }
  if (pay.length) lines.push(...pay)
  if (shareUrl) lines.push(`明細看這裡：${shareUrl}`)
  return lines.join('\n')
}
