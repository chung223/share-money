import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { reminderText, TONES, type Tone } from '../lib/reminder'
import { shareUrl } from '../lib/share'
import type { PersonResult } from '../lib/split'
import type { Project } from '../lib/types'
import { navigate } from '../router'
import { Sheet } from './ui'

const TONE_KEY = 'banban:reminderTone'

export default function ReminderSheet({ p, person, onClose }: { p: Project; person: PersonResult | null; onClose: () => void }) {
  const base = useStore((s) => s.data.baseCurrency)
  const payInfo = useStore((s) => s.data.payInfo)
  const showToast = useStore((s) => s.showToast)
  const [tone, setTone] = useState<Tone>(() => (localStorage.getItem(TONE_KEY) as Tone) || 'normal')
  const [text, setText] = useState('')
  const link = p.share && p.share.expiresAt > Date.now() ? shareUrl(p.share.id, p.share.key) : null
  const hasPay = !!(payInfo?.account || payInfo?.linePay)

  useEffect(() => {
    if (person) setText(reminderText({ project: p, person, baseCurrency: base, payInfo, shareUrl: link, tone }))
  }, [p, person, base, payInfo, link, tone])

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
