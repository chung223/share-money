import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { navigate } from '../router'
import { CATEGORIES, categoryOf, modeLabel } from '../lib/category'
import { computeSplit, fmtMoney } from '../lib/split'
import { tripSettlement } from '../lib/balances'
import { aiChat } from '../lib/ai'
import { PROJECT_EMOJIS } from '../lib/types'
import type { Project } from '../lib/types'
import { Avatar, EmojiPicker, Empty, Sheet } from '../components/ui'
import QuickCreateSheet from '../components/QuickCreateSheet'
import TripShareSheet from '../components/TripShareSheet'
import { useAiAvailable } from '../components/useAiAvailable'

const TRIP_EMOJIS = ['🧳', '✈️', '🏝️', '🗼', '⛺', '🚗', '🎢', '🏔️', '🎿', '🚢', '🍜', '🎉', ...PROJECT_EMOJIS]

export default function TripPage({ id }: { id: string }) {
  const trip = useStore((s) => s.data.trips?.find((t) => t.id === id))
  const projects = useStore((s) => s.data.projects)
  const base = useStore((s) => s.data.baseCurrency)
  const me = useStore((s) => s.data.me)
  const updateTrip = useStore((s) => s.updateTrip)
  const updateProject = useStore((s) => s.updateProject)
  const deleteTrip = useStore((s) => s.deleteTrip)
  const addProject = useStore((s) => s.addProject)
  const showToast = useStore((s) => s.showToast)
  const ai = useAiAvailable()
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [quick, setQuick] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState<null | 'keep' | 'all'>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)

  const mine = useMemo(() => projects.filter((p) => p.tripId === id).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt), [projects, id])
  const settle = useMemo(() => tripSettlement(mine, base), [mine, base])
  const totals = useMemo(() => {
    let sum = 0
    let unknown = false
    for (const p of mine) {
      const r = computeSplit(p, base)
      if (p.currency === base) sum += r.grandTotalRounded
      else if (r.baseGrandTotal != null) sum += r.baseGrandTotal
      else unknown = true
    }
    return { sum, unknown }
  }, [mine, base])
  const myAlias = trip?.share?.myPersonId ?? me.id

  if (!trip) {
    return (
      <div className="page">
        <Empty mood="sad" title="找不到這趟旅程">
          <button type="button" className="btn btn--primary" onClick={() => navigate('/', true)}>
            回首頁
          </button>
        </Empty>
      </div>
    )
  }
  const dates = mine.length ? `${mine[0].date} → ${mine[mine.length - 1].date}` : ''

  const markTransfer = (from: string, to: string) => {
    // 把這兩人之間所有未結清的轉帳（雙向）都標成完成：因為建議轉帳已經互相抵銷過了
    let n = 0
    for (const { project, transfer } of settle.open) {
      if ((transfer.from === from && transfer.to === to) || (transfer.from === to && transfer.to === from)) {
        updateProject(project.id, (pp) => {
          pp.settled[transfer.key] = true
          if (transfer.to === pp.payerId) delete pp.settled[transfer.from]
        })
        n++
      }
    }
    showToast(`已標記 ${n} 筆轉帳為完成`, '✅')
  }

  const summarise = async () => {
    setSummaryBusy(true)
    try {
      const lines = mine.map((p) => {
        const r = computeSplit(p, base)
        const payer = p.people.find((x) => x.id === p.payerId)
        return `- ${p.date} ${p.emoji}${p.name || categoryOf(p).unnamed}（${categoryOf(p).label}）總額 ${fmtMoney(r.grandTotalRounded, p.currency)}${r.baseGrandTotal != null && p.currency !== base ? ` ≈ ${fmtMoney(r.baseGrandTotal, base)}` : ''}，${r.multiPayer ? '多人先付' : `${payer?.name ?? '？'} 先付`}，${r.transfers.filter((t) => t.settled).length}/${r.transfers.length} 筆已還`
      })
      const nets = settle.nets.map((n) => `${n.person.name}：淨 ${n.net >= 0 ? '+' : ''}${fmtMoney(n.net, base)}`).join('；')
      const sugg = settle.transfers.map((t) => `${t.from.name} → ${t.to.name} ${fmtMoney(t.amount, base)}`).join('；') || '不用轉帳'
      const user = `旅程：${trip.emoji} ${trip.name}（${dates}）\n帳本：\n${lines.join('\n')}\n未結清淨額：${nets || '全部結清'}\n最少轉帳建議：${sugg}\n主要幣別 ${base}。`
      const out = await aiChat({
        system: '你是旅遊分帳小幫手。根據資料寫一段給群組看的結算總結：先一句話講這趟花了多少、誰墊最多，再列「誰轉給誰多少」，最後一句可愛的收尾。繁體中文台灣用語，150 字內，可用少量 emoji，只輸出本文。',
        user,
        maxTokens: 2500,
        temperature: 0.7,
      })
      setSummary(out.trim())
    } catch (e) {
      showToast(e instanceof Error ? e.message.slice(0, 100) : 'AI 失敗', '😵')
    } finally {
      setSummaryBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="返回">
          ←
        </button>
        <div className="grow" />
        <button type="button" className={`btn btn--sm ${trip.share ? 'btn--mint' : 'btn--ghost'}`} onClick={() => setShareOpen(true)}>
          👥 {trip.share ? '共編中' : '共編'}
        </button>
        <button type="button" className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="更多">
          ⋯
        </button>
      </header>

      <div className="project-head">
        <button type="button" className="project-head__emoji" onClick={() => setEmojiOpen(true)}>
          {trip.emoji}
        </button>
        <div className="grow stack-xs">
          <input className="input input--title" placeholder="這趟叫什麼？例：沖繩三天" value={trip.name} onChange={(e) => updateTrip(trip.id, (t) => (t.name = e.target.value))} />
          <div className="muted small">
            {mine.length} 本帳{dates ? ` · ${dates}` : ''} · 共 {fmtMoney(totals.sum, base)}
            {totals.unknown ? '＋外幣未換算' : ''}
          </div>
        </div>
      </div>

      <main className="stack">
        {/* 結算 */}
        <section className={`card stack ${settle.transfers.length ? 'card--pink' : 'card--mint'}`}>
          <div className="row between center">
            <div className="section-title">💸 整趟結算</div>
            {ai && mine.length > 0 && (
              <button type="button" className="btn btn--sm btn--butter" disabled={summaryBusy} onClick={summarise}>
                {summaryBusy ? 'AI 寫中…' : '✨ AI 總結'}
              </button>
            )}
          </div>
          {mine.length === 0 ? (
            <p className="muted small">先加幾本帳進來，這裡會把所有帳本互相抵銷後，算出最少轉幾次就結清。</p>
          ) : settle.transfers.length === 0 ? (
            <p className="small">全部結清了 🎉{settle.foreign.length ? '（外幣沒設匯率的不算）' : ''}</p>
          ) : (
            <div className="stack-xs">
              {settle.transfers.map((t) => (
                <div key={t.from.id + t.to.id} className="line line--person">
                  <span className="row gap-s center">
                    <span className={`mini-avatar c-${t.from.color}`}>{t.from.emoji}</span>
                    {t.from.name} → <span className={`mini-avatar c-${t.to.color}`}>{t.to.emoji}</span>
                    {t.to.name}
                  </span>
                  <span className="row gap-s center">
                    <span className="strong">{fmtMoney(t.amount, base)}</span>
                    {(t.to.id === myAlias || t.from.id === myAlias) && (
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => markTransfer(t.from.id, t.to.id)}>
                        ✓ 已轉
                      </button>
                    )}
                  </span>
                </div>
              ))}
              <p className="muted small">已互相抵銷；按「已轉」會把兩人之間所有帳本的轉帳一起標完成。</p>
            </div>
          )}
          {settle.nets.length > 0 && (
            <div className="chip-row">
              {settle.nets.map((n) => (
                <span key={n.person.id} className={`chip chip--xs ${n.net > 0 ? 'is-on' : ''}`}>
                  {n.person.emoji} {n.person.name} {n.net >= 0 ? '+' : '−'}
                  {fmtMoney(Math.abs(n.net), base)}
                </span>
              ))}
            </div>
          )}
          {summary && (
            <div className="stack-xs">
              <div className="note-line" style={{ whiteSpace: 'pre-wrap' }}>
                {summary}
              </div>
              <button type="button" className="btn btn--ghost btn--sm center-self" onClick={() => navigator.clipboard.writeText(summary).then(() => showToast('已複製', '📋'))}>
                📋 複製給群組
              </button>
            </div>
          )}
        </section>

        {/* 帳本 */}
        <div className="row between center">
          <div className="section-title">🧾 這趟的帳本</div>
          <div className="row gap-s">
            {ai && (
              <button type="button" className="btn btn--sm btn--mint" onClick={() => setQuick(true)}>
                ✨ 一句話
              </button>
            )}
            <button type="button" className="btn btn--sm btn--primary" onClick={() => setAddOpen(true)}>
              ＋ 加一本
            </button>
          </div>
        </div>
        {mine.length === 0 ? (
          <Empty mood="wow" title="還沒有帳本" hint="機票、住宿、每一餐、計程車，各開一本，分類各自選。" />
        ) : (
          <div className="stack-s">
            {mine.map((p) => (
              <TripProjectCard key={p.id} p={p} base={base} />
            ))}
          </div>
        )}
        {settle.foreign.length > 0 && <p className="muted small">有 {settle.foreign.length} 筆外幣轉帳沒設匯率，沒算進結算。到那本帳設定匯率就會納入。</p>}
      </main>

      <Sheet open={emojiOpen} onClose={() => setEmojiOpen(false)} title="換個圖示">
        <EmojiPicker
          value={trip.emoji}
          options={[...new Set(TRIP_EMOJIS)]}
          onChange={(e) => {
            updateTrip(trip.id, (t) => (t.emoji = e))
            setEmojiOpen(false)
          }}
        />
      </Sheet>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="加一本到這趟">
        <div className="stack">
          <div className="label">這筆是什麼？</div>
          <div className="cat-grid">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className="cat-btn"
                onClick={() => {
                  setAddOpen(false)
                  const p = addProject(undefined, c.id, trip.id)
                  navigate(`/p/${p.id}`)
                }}
              >
                <span className="cat-btn__emoji">{c.emoji}</span>
                {c.label}
              </button>
            ))}
          </div>
          <p className="muted small">同行的人會自動帶入新帳本。</p>
        </div>
      </Sheet>

      <QuickCreateSheet open={quick} onClose={() => setQuick(false)} tripId={trip.id} />
      <TripShareSheet trip={trip} open={shareOpen} onClose={() => setShareOpen(false)} />

      <Sheet open={menuOpen} onClose={() => { setMenuOpen(false); setConfirmDel(null) }} title={trip.name || '旅程'}>
        <div className="stack">
          {!confirmDel ? (
            <>
              <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => setConfirmDel('keep')}>
                🗑 刪除旅程（帳本保留、變回一般帳本）
              </button>
              <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => setConfirmDel('all')}>
                🗑 刪除旅程和裡面所有帳本
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                deleteTrip(trip.id, confirmDel === 'all')
                navigate('/', true)
              }}
            >
              確定{confirmDel === 'all' ? '連帳本一起' : ''}刪除（救不回來喔）
            </button>
          )}
        </div>
      </Sheet>
    </div>
  )
}

function TripProjectCard({ p, base }: { p: Project; base: string }) {
  const r = useMemo(() => computeSplit(p, base), [p, base])
  const cat = categoryOf(p)
  const done = r.transfers.filter((t) => t.settled).length
  return (
    <button type="button" className="card project-card" onClick={() => navigate(`/p/${p.id}`)}>
      <div className="project-card__emoji">{p.emoji}</div>
      <div className="project-card__body">
        <div className="project-card__name">{p.name || cat.unnamed}</div>
        <div className="project-card__meta">
          <span>{p.date}</span>
          <span className="dot">·</span>
          <span>{cat.label}</span>
          <span className="dot">·</span>
          <span>{modeLabel(p.mode, cat)}</span>
        </div>
        <div className="project-card__people">
          {p.people.slice(0, 6).map((x) => (
            <Avatar key={x.id} person={x} size={22} />
          ))}
        </div>
      </div>
      <div className="project-card__right">
        <div className="project-card__total">{fmtMoney(r.grandTotalRounded, p.currency)}</div>
        {r.baseGrandTotal != null && p.currency !== base && <div className="project-card__base">≈ {fmtMoney(r.baseGrandTotal, base)}</div>}
        <div className={`pill ${r.transfers.length && done === r.transfers.length ? 'pill--mint' : 'pill--grey'}`}>{r.transfers.length ? `${done}/${r.transfers.length}` : '—'}</div>
      </div>
    </button>
  )
}
