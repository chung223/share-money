import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { navigate } from '../router'
import { computeSplit, fmtMoney } from '../lib/split'
import { Empty, Mascot, Sheet } from '../components/ui'
import type { Project } from '../lib/types'
import type { Group } from '../lib/types'
import { CATEGORIES, categoryOf, modeLabel, type Category } from '../lib/category'
import BalancesSheet from '../components/BalancesSheet'
import QuickCreateSheet from '../components/QuickCreateSheet'
import LineInboxSheet from '../components/LineInboxSheet'
import { useAiAvailable } from '../components/useAiAvailable'
import { tripSettlement } from '../lib/balances'
import type { Trip } from '../lib/types'

const NO_TRIPS: Trip[] = []

// zustand selectors must return a stable reference, or React re-renders forever
const NO_GROUPS: Group[] = []


function ProjectCard({ p, base }: { p: Project; base: string }) {
  const r = useMemo(() => computeSplit(p, base), [p, base])
  const cat = categoryOf(p)
  const others = r.transfers
  const settledCount = others.filter((x) => x.settled).length
  const allSettled = others.length > 0 && settledCount === others.length
  const pending = others.filter((x) => !x.settled)
  return (
    <button type="button" className={`card project-card ${allSettled ? 'is-done' : ''}`} onClick={() => navigate(`/p/${p.id}`)}>
      <div className="project-card__emoji">{p.emoji}</div>
      <div className="project-card__body">
        <div className="project-card__name">{p.name || cat.unnamed}</div>
        <div className="project-card__meta">
          <span>{p.date}</span>
          <span className="dot">·</span>
          <span>{cat.label}</span>
          <span className="dot">·</span>
          <span>{modeLabel(p.mode, cat)}</span>
          <span className="dot">·</span>
          <span>{p.people.length} 人</span>
        </div>
        <div className="project-card__people">
          {p.people.slice(0, 6).map((x) => (
            <span key={x.id} className={`mini-avatar c-${x.color}`}>
              {x.emoji}
            </span>
          ))}
          {p.people.length > 6 && <span className="mini-avatar mini-avatar--more">+{p.people.length - 6}</span>}
        </div>
      </div>
      <div className="project-card__right">
        <div className="project-card__total">{fmtMoney(r.grandTotalRounded, p.currency)}</div>
        {r.baseGrandTotal != null && p.currency !== base && <div className="project-card__base">≈ {fmtMoney(r.baseGrandTotal, base)}</div>}
        <div className={`pill ${allSettled ? 'pill--mint' : pending.length ? 'pill--pink' : 'pill--grey'}`}>
          {allSettled ? '✓ 已結清' : others.length ? `${settledCount}/${others.length} ${r.multiPayer ? '轉帳' : '收款'}` : '只有自己'}
        </div>
      </div>
    </button>
  )
}

export default function Home() {
  const projects = useStore((s) => s.data.projects)
  const base = useStore((s) => s.data.baseCurrency)
  const addProject = useStore((s) => s.addProject)
  const encrypted = useStore((s) => s.encrypted)
  const lock = useStore((s) => s.lock)

  const me = useStore((s) => s.data.me.id)
  const totalOwed = useMemo(() => {
    let sum = 0
    for (const p of projects) {
      const r = computeSplit(p, base)
      for (const t of r.transfers) {
        if (t.settled) continue
        // money coming back to me (or to whoever paid, when I'm not in the project)
        const toMe = t.to === me || (!p.people.some((x) => x.id === me) && t.to === p.payerId)
        if (!toMe) continue
        if (t.dueCurrency === base) sum += t.remaining
      }
    }
    return sum
  }, [projects, base, me])

  const groups = useStore((s) => s.data.groups ?? NO_GROUPS)
  const trips = useStore((s) => s.data.trips ?? NO_TRIPS)
  const addTrip = useStore((s) => s.addTrip)
  const [newTrip, setNewTrip] = useState(false)
  const [tripName, setTripName] = useState('')
  const [pick, setPick] = useState(false)
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [balances, setBalances] = useState(false)
  const [quick, setQuick] = useState(false)
  const lineDrafts = useStore((s) => s.lineDrafts)
  const [inbox, setInbox] = useState(false)
  // LINE bot 的按鈕會帶 #/inbox、#/balances 進來
  useEffect(() => {
    const h = location.hash
    if (h.startsWith('#/inbox')) {
      setInbox(true)
      history.replaceState(null, '', '#/')
    } else if (h.startsWith('#/balances')) {
      navigate('/friends', true)
    }
  }, [])
  const ai = useAiAvailable()
  const create = (groupId?: string, category?: Category) => {
    setPick(false)
    const p = addProject(groupId, category)
    navigate(`/p/${p.id}`)
  }
  const onCreate = () => setPick(true)
  const usedCats = useMemo(() => new Set(projects.filter((p) => !p.tripId).map((p) => categoryOf(p).id)), [projects])
  const loose = projects.filter((p) => !p.tripId || !trips.some((t) => t.id === p.tripId))
  const shown = filter === 'all' ? loose : loose.filter((p) => categoryOf(p).id === filter)

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <Mascot size={40} />
          <div>
            <div className="brand__name">반반 BanBan</div>
            <div className="brand__sub">半半分帳 · 你先付，我來算</div>
          </div>
        </div>
        <div className="row gap-s">
          {encrypted && (
            <button type="button" className="icon-btn" title="上鎖" onClick={lock}>
              🔒
            </button>
          )}
          <button type="button" className="icon-btn" title="朋友" onClick={() => navigate('/friends')}>
            👥
          </button>
          <button type="button" className="icon-btn" title="設定" onClick={() => navigate('/settings')}>
            ⚙️
          </button>
        </div>
      </header>

      {projects.length > 0 && (
        <button type="button" className="hero-stat card card--pink" onClick={() => navigate('/friends')}>
          <div>
            <div className="hero-stat__label">還沒收回來的錢 · 點我看每個人</div>
            <div className="hero-stat__value">{fmtMoney(totalOwed, base)}</div>
          </div>
          <div className="hero-stat__emoji">{totalOwed > 0 ? '🥺' : '🎉'}</div>
        </button>
      )}

      {lineDrafts.length > 0 && (
        <button type="button" className="card card--mint hero-stat" onClick={() => setInbox(true)}>
          <div>
            <div className="hero-stat__label">💚 LINE 傳來的草稿</div>
            <div className="strong">{lineDrafts.length} 筆等你建帳本</div>
          </div>
          <div className="hero-stat__emoji">📥</div>
        </button>
      )}
      <main className="stack">
        {projects.length === 0 ? (
          <Empty title="還沒有帳本呢" hint="聚餐、計程車、團購、旅行，每次代墊都是一個小帳本。">
            <button type="button" className="btn btn--primary btn--lg" onClick={onCreate}>
              ＋ 開一個新帳本
            </button>
          </Empty>
        ) : (
          <>
            {trips.length > 0 && (
              <div className="stack-s">
                {trips.map((t) => (
                  <TripCard key={t.id} t={t} projects={projects} base={base} />
                ))}
              </div>
            )}
            {usedCats.size > 1 && (
              <div className="chip-row">
                <button type="button" className={`chip chip--xs ${filter === 'all' ? 'is-on' : ''}`} onClick={() => setFilter('all')}>
                  全部
                </button>
                {CATEGORIES.filter((c) => usedCats.has(c.id)).map((c) => (
                  <button key={c.id} type="button" className={`chip chip--xs ${filter === c.id ? 'is-on' : ''}`} onClick={() => setFilter(c.id)}>
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            )}
            {shown.map((p) => (
              <ProjectCard key={p.id} p={p} base={base} />
            ))}
          </>
        )}
      </main>

      {projects.length > 0 && (
        <button type="button" className="fab" onClick={onCreate} aria-label="新增帳本">
          ＋
        </button>
      )}

      <BalancesSheet open={balances} onClose={() => setBalances(false)} />
      <Sheet open={newTrip} onClose={() => setNewTrip(false)} title="🧳 開一趟旅程">
        <div className="stack">
          <input className="input" placeholder="例：沖繩三天兩夜" value={tripName} autoFocus onChange={(e) => setTripName(e.target.value)} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!tripName.trim()}
            onClick={() => {
              const t = addTrip(tripName.trim(), '🧳')
              setNewTrip(false)
              setTripName('')
              navigate(`/t/${t.id}`)
            }}
          >
            建立
          </button>
        </div>
      </Sheet>
      <QuickCreateSheet open={quick} onClose={() => setQuick(false)} />
      <LineInboxSheet open={inbox} onClose={() => setInbox(false)} />
      <Sheet open={pick} onClose={() => setPick(false)} title="開新帳本">
        <div className="stack">
          {ai && (
            <button type="button" className="btn btn--mint btn--lg" onClick={() => { setPick(false); setQuick(true) }}>
              ✨ 說一句話，AI 幫你開
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => { setPick(false); setNewTrip(true) }}>
            🧳 開一趟旅程（裝很多本帳，一起結算）
          </button>
          <div className="label">{ai ? '或自己選分類' : '這次是什麼？'}</div>
          <div className="cat-grid">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" className="cat-btn" onClick={() => create(undefined, c.id)}>
                <span className="cat-btn__emoji">{c.emoji}</span>
                {c.label}
              </button>
            ))}
          </div>
          {groups.length > 0 && (
            <>
              <div className="label">或用常用組合</div>
              <div className="stack-s">
                {groups.map((g) => (
                  <button key={g.id} type="button" className="btn btn--ghost row gap center" onClick={() => create(g.id)}>
                    <span style={{ fontSize: 22 }}>{g.emoji}</span>
                    <span className="grow left">
                      {g.name}
                      <span className="muted small"> · {g.personIds.length} 人</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </Sheet>
    </div>
  )
}

function TripCard({ t, projects, base }: { t: Trip; projects: Project[]; base: string }) {
  const mine = projects.filter((p) => p.tripId === t.id)
  const s = useMemo(() => tripSettlement(mine, base), [mine, base])
  const open = s.transfers.length
  return (
    <button type="button" className={`card project-card trip-card ${open === 0 && mine.length ? 'is-done' : ''}`} onClick={() => navigate(`/t/${t.id}`)}>
      <div className="project-card__emoji">{t.emoji}</div>
      <div className="project-card__body">
        <div className="project-card__name">{t.name || '未命名旅程'}</div>
        <div className="project-card__meta">
          <span>🧳 旅程</span>
          <span className="dot">·</span>
          <span>{mine.length} 本帳</span>
          {t.share && (
            <>
              <span className="dot">·</span>
              <span>👥 共編</span>
            </>
          )}
        </div>
        <div className="project-card__people">
          {s.people.slice(0, 6).map((x) => (
            <span key={x.id} className={`mini-avatar c-${x.color}`}>
              {x.emoji}
            </span>
          ))}
        </div>
      </div>
      <div className="project-card__right">
        <div className={`pill ${open ? 'pill--pink' : 'pill--mint'}`}>{mine.length === 0 ? '空的' : open ? `還差 ${open} 筆轉帳` : '✓ 結清'}</div>
      </div>
    </button>
  )
}
