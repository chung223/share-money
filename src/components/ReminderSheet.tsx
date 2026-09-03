import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { reminderText, TONES, type Tone } from '../lib/reminder'
import { fmtMoney } from '../lib/split'
import { shareUrl } from '../lib/share'
import type { PersonResult } from '../lib/split'
import type { Project } from '../lib/types'
import { navigate } from '../router'
import { Sheet } from './ui'
import { aiChat } from '../lib/ai'
import { reminderSystem, reminderUser } from '../lib/aiAssist'
import { payLines, fmtDateShort } from '../lib/reminder'
import { useAiAvailable } from './useAiAvailable'

const TONE_KEY = 'banban:reminderTone'

export default function ReminderSheet({ p, person, amount, baseAmount, amountText, onClose }: { p: Project; person: PersonResult | null; amount?: number; baseAmount?: number | null; amountText?: string; onClose: () => void }) {
  const base = useStore((s) => s.data.baseCurrency)
  const payInfo = useStore((s) => s.data.payInfo)
  const showToast = useStore((s) => s.showToast)
  const [tone, setTone] = useState<Tone>(() => (localStorage.getItem(TONE_KEY) as Tone) || 'normal')
  const [text, setText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const ai = useAiAvailable()
  const writeWithAi = async () => {
    if (!person) return
    setAiBusy(true)
    try {
      const daysAgo = Math.max(0, Math.round((Date.now() - new Date(p.date + 'T00:00:00').getTime()) / 86_400_000))
      const amt = amountText ?? (amount !== undefined ? fmtMoney(amount, p.currency) : fmtMoney(person.totalRounded, p.currency))
      const user = reminderUser({ toName: person.person.name, amountText: amt, what: `${fmtDateShort(p.date)} ${p.emoji}${p.name || '那次'}`, daysAgo, tone: TONES.find((t) => t.value === tone)?.label ?? '正常', payLines: payLines(payInfo), link })
      const out = await aiChat({ system: reminderSystem(), user, maxTokens: 2000, temperature: 0.9 })
      if (out.trim()) setText(out.trim())
    } catch (e) {
      showToast(e instanceof Error ? e.message.slice(0, 100) : 'AI 失敗', '😵')
    } finally {
      setAiBusy(false)
    }
  }
  const link = p.share && p.share.expiresAt > Date.now() ? shareUrl(p.share.id, p.share.key) : null
  const hasPay = !!(payInfo?.account || payInfo?.linePay)

  useEffect(() => {
    if (person) setText(reminderText({ project: p, person, amount, baseAmount, amountText, baseCurrency: base, payInfo, shareUrl: link, tone }))
  }, [p, person, amount, baseAmount, amountText, base, payInfo, link, tone])

  const pick = (t: Tone) => {
    setTone(t)
    localStorage.setItem(TONE_KEY, t)
  }
  const send = async () => {
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        showToast('已複製，貼給對方吧', '📋')
      }
      onClose()
    } catch {
      /* cancelled */
    }
  }
  const copy = () =>
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showToast('已複製', '📋')
        onClose()
      })
      .catch(() => showToast('複製失敗，請長按選取', '🙈'))

  return (
    <Sheet open={!!person} onClose={onClose} title={person ? `📣 催 ${person.person.emoji} ${person.person.name}` : ''}>
      <div className="stack">
        <div className="chip-row">
          {TONES.map((t) => (
            <button key={t.value} type="button" className={`chip ${tone === t.value ? 'is-on' : ''}`} onClick={() => pick(t.value)}>
              {t.label}
            </button>
          ))}
        </div>
        <textarea className="textarea" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
        {ai && (
          <button type="button" className="btn btn--mint btn--sm center-self" disabled={aiBusy} onClick={writeWithAi}>
            {aiBusy ? 'AI 想句子中…' : '✨ 讓 AI 寫一句（可一直換）'}
          </button>
        )}
        {!hasPay && (
          <p className="small">
            💡 還沒填收款方式，對方會不知道要轉去哪。
            <button type="button" className="link" onClick={() => navigate('/settings')}>
              去設定
            </button>
          </p>
        )}
        <div className="row gap">
          <button type="button" className="btn btn--ghost grow" onClick={copy}>
            📋 複製
          </button>
          <button type="button" className="btn btn--primary grow" onClick={send}>
            📤 傳給對方
          </button>
        </div>
      </div>
    </Sheet>
  )
}
