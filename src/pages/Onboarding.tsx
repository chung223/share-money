import { useState } from 'react'
import { useStore } from '../store'
import { Mascot } from '../components/ui'
import { PersonEditor } from './SettingsPage'
import PayInfoSection from '../components/PayInfoSection'

const TIPS = [
  { emoji: '🧾', title: '每餐一個帳本', text: '按 ＋ 開帳本、加人、輸入金額。可以掃電子發票、拍照或貼上外送訂單文字。' },
  { emoji: '🍕', title: '三種分法', text: '均攤最快；「各點各的」點誰吃；「個人＋共享」自己的自己付、共用的大家分。服務費、外送費也能加。' },
  { emoji: '✨', title: '結果頁搞定收錢', text: '一鍵分享文字到群組，或給朋友專屬連結：對方看自己那份、按「我轉了」你就自動打勾。還能催款。' },
  { emoji: '☁️', title: '設定裡還有', text: '多裝置同步、推播通知、PIN 上鎖、常用組合。資料都在你的裝置，同步會先加密。' },
]

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const me = useStore((s) => s.data.me)
  const update = useStore((s) => s.update)
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState({ ...me, name: me.name === '我' ? '' : me.name })
  const total = 4
  const next = () => setStep((s) => s + 1)

  return (
    <div className="page onboarding">
      <div className="onboarding__dots" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i === step ? 'is-on' : ''} />
        ))}
      </div>

      {step === 0 && (
        <div className="stack center-items onboarding__hero">
          <Mascot size={140} className="mascot--float" />
          <h1 className="onboarding__title">반반 BanBan</h1>
          <p className="onboarding__sub">半半分帳 · 你先付，我來算</p>
          <p className="muted center-text">聚餐、外送、旅行，誰該給你多少一目瞭然。不用註冊，資料只在你的手機裡。</p>
          <button type="button" className="btn btn--primary btn--lg" onClick={next}>
            開始 →
          </button>
          <button type="button" className="link" onClick={onDone}>
            我會用了，跳過
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          <h2 className="onboarding__h2">🐥 先說你是誰</h2>
          <p className="muted small">這個名字會出現在分帳結果和給朋友的連結上。</p>
          <section className="card">
            <PersonEditor person={draft} title="我" onChange={setDraft} />
          </section>
          <button
            type="button"
            className="btn btn--primary btn--lg"
            disabled={!draft.name.trim()}
            onClick={() => {
              update((d) => (d.me = { ...draft, name: draft.name.trim() }))
              next()
            }}
          >
            下一步 →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <h2 className="onboarding__h2">💳 怎麼收錢（選填）</h2>
          <p className="muted small">填了之後，朋友打開你的分享連結就能直接複製帳號轉給你。之後在設定也能改。</p>
          <PayInfoSection />
          <button type="button" className="btn btn--primary btn--lg" onClick={next}>
            下一步 →
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <h2 className="onboarding__h2">📖 三十秒學會</h2>
          <div className="stack-s">
            {TIPS.map((t) => (
              <div key={t.title} className="card row gap">
                <span className="onboarding__tip-emoji">{t.emoji}</span>
                <div>
                  <div className="strong">{t.title}</div>
                  <div className="muted small">{t.text}</div>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn--primary btn--lg" onClick={onDone}>
            開始用 🎉
          </button>
        </div>
      )}
    </div>
  )
}
