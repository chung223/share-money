import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { navigate } from '../router'
import { fmtMoney } from '../lib/split'
import { CATEGORIES } from '../lib/category'
import { monthRange, monthStats, shiftMonth } from '../lib/stats'
import type { CategoryStat } from '../lib/stats'
import { Avatar, Empty } from '../components/ui'
import type { Category } from '../lib/category'

const NO_TRIPS: never[] = []

/** 分類配色：沿用調色盤（深色模式有自己的版本）。 */
const CAT_COLOR: Record<Category, string> = {
  food: 'peach',
  transport: 'sky',
  shopping: 'pink',
  travel: 'mint',
  fun: 'lavender',
  other: 'butter',
}

function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthLabel(key: string) {
  const [y, m] = key.split('-')
  return `${y} 年 ${Number(m)} 月`
}

/** 圓餅（甜甜圈）：每一片用 stroke-dasharray 畫在同一個圓上，不裝圖表套件。 */
function Donut({ items, total, count }: { items: CategoryStat[]; total: number; count: number }) {
  let acc = 0
  return (
    <svg viewBox="0 0 120 120" className="stats-donut" role="img" aria-label="分類比例">
      <circle cx="60" cy="60" r="42" className="stats-donut__bg" />
      {items.map((c) => {
        const pct = (c.total / total) * 100
        const el = (
          <circle
            key={c.id}
            cx="60"
            cy="60"
            r="42"
            pathLength={100}
            className="stats-donut__slice"
            style={{ stroke: `var(--c-${CAT_COLOR[c.id]})` }}
            strokeDasharray={`${Math.max(pct - 0.6, 0.01)} ${100 - Math.max(pct - 0.6, 0.01)}`}
            strokeDashoffset={-acc}
          />
        )
        acc += pct
        return el
      })}
      <text x="60" y="58" textAnchor="middle" className="stats-donut__num">
        {count}
      </text>
      <text x="60" y="76" textAnchor="middle" className="stats-donut__cap">
        帳本
      </text>
    </svg>
  )
}

export default function StatsPage() {
  const projects = useStore((s) => s.data.projects)
  const trips = useStore((s) => s.data.trips ?? NO_TRIPS)
  const meId = useStore((s) => s.data.me.id)
  const base = useStore((s) => s.data.baseCurrency)
  const today = todayLocal()
  const range = useMemo(() => monthRange(projects, today), [projects, today])
  const [month, setMonth] = useState(today.slice(0, 7))
  const st = useMemo(() => monthStats(projects, meId, base, month, trips), [projects, meId, base, month, trips])
  const maxFriend = Math.max(1, ...st.friends.map((f) => f.total))
  const hasPrev = month > range.min
  const hasNext = month < range.max

  return (
    <div className="page">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="返回">
          ←
        </button>
        <h1 className="topbar__title">📊 統計</h1>
        <span style={{ width: 40 }} />
      </header>

      <div className="stats-month">
        <button type="button" className="icon-btn" disabled={!hasPrev} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上個月">
          ‹
        </button>
        <div className="stats-month__label">{monthLabel(month)}</div>
        <button type="button" className="icon-btn" disabled={!hasNext} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="下個月">
          ›
        </button>
      </div>

      {st.total <= 0 ? (
        <Empty mood="sleepy" title="這個月沒有代墊" hint="你先付、朋友欠你的帳，會出現在這裡。">
          {st.foreignCount > 0 && <div className="muted small">有 {st.foreignCount} 筆外幣還沒換算，沒算進來</div>}
        </Empty>
      ) : (
        <main className="stack">
          <div className="card card--pink hero-stat">
            <div className="stats-grow">
              <div className="hero-stat__label">這個月幫大家代墊</div>
              <div className="hero-stat__value">{fmtMoney(st.total, base)}</div>
              <div className="small">
                {st.projectCount} 本帳 · {st.remaining > 0 ? `還沒收 ${fmtMoney(st.remaining, base)}` : '都收回來了'}
              </div>
            </div>
            <div className="hero-stat__emoji">{st.remaining > 0 ? '💸' : '🎉'}</div>
          </div>

          <section className="card stack">
            <div className="strong">花在哪裡</div>
            <div className="stats-pie">
              <Donut items={st.categories} total={st.total} count={st.projectCount} />
              <ul className="stats-legend">
                {st.categories.map((c) => {
                  const meta = CATEGORIES.find((x) => x.id === c.id)!
                  return (
                    <li key={c.id}>
                      <span className="stats-dot" style={{ background: `var(--c-${CAT_COLOR[c.id]})` }} />
                      <span className="stats-legend__name">
                        {meta.emoji} {meta.label}
                      </span>
                      <span className="stats-legend__val">
                        {fmtMoney(c.total, base)}
                        <span className="muted small"> {Math.round((c.total / st.total) * 100)}%</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>

          <section className="card stack">
            <div className="strong">誰欠最多</div>
            <ol className="stats-rank">
              {st.friends.map((f, i) => (
                <li key={f.person.id}>
                  <span className="stats-rank__no">{i + 1}</span>
                  <Avatar person={f.person} size={36} />
                  <div className="stats-rank__body">
                    <div className="stats-rank__top">
                      <span className="stats-rank__name">{f.person.name}</span>
                      <span className="stats-rank__val">{fmtMoney(f.total, base)}</span>
                    </div>
                    <div className="stats-bar">
                      <div className="stats-bar__fill" style={{ width: `${Math.max(4, (f.total / maxFriend) * 100)}%`, background: `var(--c-${f.person.color})` }} />
                    </div>
                    <div className="muted small">{f.remaining > 0 ? `還差 ${fmtMoney(f.remaining, base)}` : '✓ 已還清'}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {st.foreignCount > 0 && <p className="muted small">有 {st.foreignCount} 筆外幣還沒換算，沒算進來。</p>}
        </main>
      )}
    </div>
  )
}
