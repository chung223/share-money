import { useEffect, useRef, useState } from 'react'
import { useStore, newPerson, today } from '../store'
import { navigate } from '../router'
import { aiChat } from '../lib/ai'
import { applyDraft, draftSystem, normaliseDraft, type ProjectDraft } from '../lib/aiAssist'
import { categoryOf } from '../lib/category'
import { fmtMoney } from '../lib/split'
import { Sheet } from './ui'

const EXAMPLES = ['昨天跟小明小華吃拉麵 900 我付的', '計程車 350 我跟阿花平分', '日本便利商店 2400 日圓，小明的便當 680 其他大家分', '今天飲料我先付：珍奶 65 兩杯是小明的，我一杯紅茶 35']

type SR = { start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; lang: string; interimResults: boolean }
function speechCtor(): (new () => SR) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** ✨ 一句話開帳本 */
export default function QuickCreateSheet({ open, onClose, tripId }: { open: boolean; onClose: () => void; tripId?: string }) {
  const data = useStore((s) => s.data)
  const addProject = useStore((s) => s.addProject)
  const updateProject = useStore((s) => s.updateProject)
  const update = useStore((s) => s.update)
  const showToast = useStore((s) => s.showToast)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<ProjectDraft | null>(null)
  const [listening, setListening] = useState(false)
  const rec = useRef<SR | null>(null)
  const canSpeak = !!speechCtor()

  useEffect(() => {
    if (!open) {
      setDraft(null)
      setText('')
    }
  }, [open])

  const listen = () => {
    const C = speechCtor()
    if (!C) return
    if (listening) {
      rec.current?.stop()
      return
    }
    const r = new C()
    r.lang = 'zh-TW'
    r.interimResults = true
    r.onresult = (e) => setText(Array.from(e.results, (x) => x[0].transcript).join(''))
    r.onend = () => setListening(false)
    rec.current = r
    setListening(true)
    r.start()
  }

  const generate = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      const ctx = { me: data.me, friends: data.friends, baseCurrency: data.baseCurrency, today: today() }
      const raw = await aiChat({ system: draftSystem({ meName: data.me.name, friendNames: data.friends.map((f) => f.name), baseCurrency: data.baseCurrency, today: ctx.today }), user: text.trim(), maxTokens: 4000 })
      setDraft(normaliseDraft(raw, ctx))
    } catch (e) {
      showToast(e instanceof Error ? e.message.slice(0, 100) : 'AI 失敗', '😵')
    } finally {
      setBusy(false)
    }
  }

  const create = () => {
    if (!draft) return
    const p = addProject(undefined, draft.category, tripId)
    let created: ReturnType<typeof newPerson>[] = []
    updateProject(p.id, (pp) => {
      created = applyDraft(pp, draft, { me: data.me, friends: data.friends, newPerson })
    })
    if (created.length) update((d) => d.friends.push(...created))
    onClose()
    navigate(`/p/${p.id}/result`)
    showToast(created.length ? `建好了，順便把 ${created.map((c) => c.name).join('、')} 存成常用朋友` : '建好了', '✨')
  }

  const total = draft ? draft.items.reduce((a, it) => a + it.price * it.qty, 0) : 0

  return (
    <Sheet open={open} onClose={onClose} title="✨ 說一句話開帳本" tall>
      <div className="stack">
        {!draft ? (
          <>
            <textarea className="input textarea" rows={4} placeholder="例：昨天跟小明小華吃拉麵 900 我付的" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <div className="chip-row">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="chip chip--xs" onClick={() => setText(ex)}>
                  {ex.slice(0, 14)}…
                </button>
              ))}
            </div>
            <div className="row gap">
              {canSpeak && (
                <button type="button" className={`btn ${listening ? 'btn--danger' : 'btn--ghost'}`} onClick={listen}>
                  {listening ? '⏹ 停止' : '🎤 用講的'}
                </button>
              )}
              <button type="button" className="btn btn--primary grow" disabled={busy || !text.trim()} onClick={generate}>
                {busy ? 'AI 整理中…' : '✨ 生成帳本'}
              </button>
            </div>
            <p className="muted small">講清楚誰、多少錢、誰先付；有講到誰吃什麼就會用「各點各的」。生成後可以再改。</p>
          </>
        ) : (
          <>
            <div className="card stack-s">
              <div className="strong">
                {draft.emoji} {draft.name || categoryOf({ emoji: draft.emoji, category: draft.category }).unnamed}
                <span className="muted small"> · {draft.date ?? today()} · {categoryOf({ emoji: draft.emoji, category: draft.category }).label}</span>
              </div>
              <div className="chip-row">
                {draft.people.map((p) => (
                  <span key={p.name} className={`chip chip--xs ${p.id ? '' : 'is-on'}`}>
                    {p.name === draft.payer ? '⭐ ' : ''}
                    {p.name}
                    {!p.id && <span className="muted"> 新</span>}
                  </span>
                ))}
              </div>
              <div className="person-result__lines">
                {draft.items.map((it, i) => (
                  <div key={i} className="line">
                    <span>
                      {it.name}
                      {it.qty > 1 ? ` ×${it.qty}` : ''}
                      <span className="muted"> {it.sharedBy === 'all' ? '大家分' : it.sharedBy.join('、')}</span>
                    </span>
                    <span>{fmtMoney(it.price * it.qty, draft.currency)}</span>
                  </div>
                ))}
                {draft.extras.map((e, i) => (
                  <div key={'e' + i} className="line line--extra">
                    <span>{e.name}</span>
                    <span>{e.type === 'percent' ? `${e.amount}%` : fmtMoney(e.amount, draft.currency)}</span>
                  </div>
                ))}
                <div className="line strong">
                  <span>合計</span>
                  <span>{fmtMoney(total, draft.currency)}</span>
                </div>
              </div>
              <div className="muted small">
                {draft.mode === 'equal' ? '均攤' : draft.mode === 'items' ? '各點各的' : '個人+共享'} · {draft.payments ? `多人先付` : `${draft.payer} 先付`}
              </div>
            </div>
            <div className="row gap">
              <button type="button" className="btn btn--ghost" onClick={() => setDraft(null)}>
                ← 改一下再生成
              </button>
              <button type="button" className="btn btn--primary grow" onClick={create}>
                建立帳本 →
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
