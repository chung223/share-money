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
import { isMobile, lineShareUrl } from '../lib/lineShare'
import { lineApi } from '../lib/line'

const TONE_KEY = 'banban:reminderTone'

export default function ReminderSheet({ p, person, amount, baseAmount, amountText, onClose }: { p: Project; person: PersonResult | null; amount?: number; baseAmount?: number | null; amountText?: string; onClose: () => void }) {
  const base = useStore((s) => s.data.baseCurrency)
  const payInfo = useStore((s) => s.data.payInfo)
  const showToast = useStore((s) => s.showToast)
  const [tone, setTone] = useState<Tone>(() => (localStorage.getItem(TONE_KEY) as Tone) || 'normal')
  const [text, setText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [meme, setMeme] = useState<{ url: string; busy: boolean } | null>(null)
  const hasSync = useStore((s) => !!s.data.sync)
  const ai = useAiAvailable()
  const makeMeme = async () => {
    if (!person) return
    setMeme({ url: '', busy: true })
    try {
      const amt = amountText ?? (amount !== undefined ? fmtMoney(amount, p.currency) : fmtMoney(person.totalRounded, p.currency))
      const mood = tone === 'angry' ? 'angry' : tone === 'cute' ? 'cute' : 'sad'
      const r = await lineApi.meme({ name: person.person.name, amountText: amt, mood })
      setMeme({ url: r.url, busy: false })
    } catch (e) {
      setMeme(null)
      showToast(e instanceof Error ? e.message : '生圖失敗', '😵')
    }
  }
  const shareMeme = async () => {
    if (!meme?.url) return
    try {
      const blob = await (await fetch(meme.url)).blob()
      const file = new File([blob], 'banban-meme.png', { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text })
      else {
        await navigator.clipboard.writeText(`${text}\n${meme.url}`)
        showToast('已複製文字＋圖片連結', '📋')
      }
    } catch {
      /* cancelled */
    }
  }
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
          <div className="row gap-s center-self wrap">
            <button type="button" className="btn btn--mint btn--sm" disabled={aiBusy} onClick={writeWithAi}>
              {aiBusy ? 'AI 想句子中…' : '✨ 讓 AI 寫一句'}
            </button>
            {hasSync && (
              <button type="button" className="btn btn--butter btn--sm" disabled={!!meme?.busy} onClick={makeMeme}>
                {meme?.busy ? '生圖中（約 30 秒）…' : '🖼 生一張催款梗圖'}
              </button>
            )}
          </div>
        )}
        {meme?.url && (
          <div className="stack-xs center-items">
            <img src={meme.url} alt="催款梗圖" style={{ width: 220, borderRadius: 16 }} />
            <div className="row gap-s">
              <button type="button" className="btn btn--primary btn--sm" onClick={shareMeme}>
                📤 傳圖給對方
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={makeMeme}>
                🎲 換一張
              </button>
            </div>
            <p className="muted small">圖片連結 7 天有效，生一張算 3 次 AI 額度。</p>
          </div>
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
          {isMobile() && (
            <a className="btn btn--mint grow" href={lineShareUrl(text)} target="_blank" rel="noreferrer" onClick={() => setTimeout(onClose, 300)}>
              💚 傳到 LINE
            </a>
          )}
          <button type="button" className="btn btn--primary grow" onClick={send}>
            📤 其他方式
          </button>
        </div>
      </div>
    </Sheet>
  )
}
