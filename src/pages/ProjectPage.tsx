import { useEffect, useMemo, useRef, useState } from 'react'
import { newItem, newPerson, uid, useStore } from '../store'
import { navigate } from '../router'
import { computeSplit, fmtMoney, itemTotal, resolveSharers, summaryText } from '../lib/split'
import { fetchRate } from '../lib/rates'
import { CURRENCIES, PROJECT_EMOJIS, currencyMeta, type Extra, type Item, type Person, type Project, type SplitMode } from '../lib/types'
import { Avatar, Confetti, EmojiPicker, Empty, MoneyInput, Segmented, Sheet } from '../components/ui'
import ImportSheet, { type ImportResult } from '../components/ImportSheet'
import { PersonEditor } from './SettingsPage'

const MODES: { value: SplitMode; label: string; emoji: string; desc: string }[] = [
  { value: 'equal', label: '均攤', emoji: '🍕', desc: '總額除以人數，最無腦' },
  { value: 'items', label: '各點各的', emoji: '🍱', desc: '每個品項點誰吃，多人就均分' },
  { value: 'mains', label: '主餐+共享', emoji: '🍲', desc: '主餐各付各的，小菜大家分' },
]

export default function ProjectPage({ id, tab }: { id: string; tab: 'items' | 'result' }) {
  const project = useStore((s) => s.data.projects.find((p) => p.id === id))
  const data = useStore((s) => s.data)
  const updateProject = useStore((s) => s.updateProject)
  const update = useStore((s) => s.update)
  const deleteProject = useStore((s) => s.deleteProject)
  const duplicateProject = useStore((s) => s.duplicateProject)
  const showToast = useStore((s) => s.showToast)

  const [emojiOpen, setEmojiOpen] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [editPerson, setEditPerson] = useState<Person | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const result = useMemo(() => (project ? computeSplit(project) : null), [project])

  if (!project || !result) {
    return (
      <div className="page">
        <Empty mood="sad" title="找不到這個帳本">
          <button type="button" className="btn btn--primary" onClick={() => navigate('/', true)}>
            回首頁
          </button>
        </Empty>
      </div>
    )
  }
  const p = project
  const set = (fn: (p: Project) => void) => updateProject(p.id, fn)
  const base = data.baseCurrency
  const foreign = p.currency !== base

  const onImport = (r: ImportResult) => {
    set((pp) => {
      for (const row of r.rows) {
        pp.items.push(newItem({ name: row.name, qty: row.qty, price: row.price, sharedBy: 'all', kind: 'shared' }))
      }
      if (r.date && !pp.items.length) pp.date = r.date
      if (pp.mode === 'equal' && pp.items.length > r.rows.length) {
        // remove the placeholder "總額" item if it is still zero
        pp.items = pp.items.filter((it) => !(it.name === '總額' && it.price === 0))
      }
    })
    if (r.date && r.date !== p.date) {
      set((pp) => (pp.date = r.date!))
    }
    showToast(`加入 ${r.rows.length} 項`, '🧾')
  }

  return (
    <div className="page page--with-bar">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="返回">
          ←
        </button>
        <div className="grow" />
        <button type="button" className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="更多">
          ⋯
        </button>
      </header>

      <div className="project-head">
        <button type="button" className="project-head__emoji" onClick={() => setEmojiOpen(true)}>
          {p.emoji}
        </button>
        <div className="grow stack-xs">
          <input className="input input--title" placeholder="這餐叫什麼？" value={p.name} onChange={(e) => set((pp) => (pp.name = e.target.value))} />
          <input className="input input--date" type="date" value={p.date} onChange={(e) => set((pp) => (pp.date = e.target.value))} />
        </div>
      </div>

      <Segmented<'items' | 'result'>
        value={tab}
        onChange={(t) => navigate(`/p/${p.id}/${t}`, true)}
        options={[
          { value: 'items', label: '📝 明細' },
          { value: 'result', label: '✨ 結果' },
        ]}
      />

      {tab === 'items' ? (
        <main className="stack">
          {/* People */}
          <section className="card stack">
            <div className="row between center">
              <div className="section-title">👯 誰一起</div>
              <span className="muted small">點頭像可以改；⭐ 是代墊的人</span>
            </div>
            <div className="people-row">
              {p.people.map((person) => (
                <div key={person.id} className={`person-chip ${person.id === p.payerId ? 'is-payer' : ''}`}>
                  <Avatar person={person} size={44} onClick={() => setEditPerson(person)} />
                  <span className="person-chip__name">{person.name}</span>
                  {person.id === p.payerId && <span className="person-chip__star">⭐</span>}
                </div>
              ))}
              <button type="button" className="person-chip person-chip--add" onClick={() => setPeopleOpen(true)}>
                <span className="avatar avatar--dashed" style={{ width: 44, height: 44 }}>
                  ＋
                </span>
                <span className="person-chip__name">加人</span>
              </button>
            </div>
          </section>

          {/* Currency */}
          <section className="card stack">
            <div className="row between center">
              <div className="section-title">💱 幣別</div>
              <select className="input input--inline" value={p.currency} onChange={(e) => set((pp) => {
                pp.currency = e.target.value
                pp.rate = e.target.value === base ? null : pp.rate
                pp.rateSource = undefined
                pp.rateDate = undefined
              })}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.code} {c.name}
                  </option>
                ))}
              </select>
            </div>
            {foreign && <RateRow p={p} base={base} set={set} />}
          </section>

          {/* Mode */}
          <section className="card stack">
            <div className="section-title">🍽 怎麼分</div>
            <div className="mode-grid">
              {MODES.map((m) => (
                <button key={m.value} type="button" className={`mode-btn ${p.mode === m.value ? 'is-on' : ''}`} onClick={() => switchMode(p, m.value, set)}>
                  <span className="mode-btn__emoji">{m.emoji}</span>
                  <span className="mode-btn__label">{m.label}</span>
                  <span className="mode-btn__desc">{m.desc}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Items */}
          <section className="card stack">
            <div className="row between center">
              <div className="section-title">🧾 明細</div>
              <button type="button" className="btn btn--sm btn--mint" onClick={() => setImportOpen(true)}>
                📷 掃描 / 匯入
              </button>
            </div>
            {p.items.length === 0 && (
              <p className="muted small">
                {p.mode === 'equal' ? '輸入這餐的總金額就好。' : '一項一項加，或用右上角掃發票。'}
              </p>
            )}
            <div className="stack-s">
              {p.items.map((it) => (
                <ItemRow key={it.id} item={it} p={p} set={set} />
              ))}
            </div>
            <div className="row gap">
              <button
                type="button"
                className="btn btn--ghost grow"
                onClick={() => set((pp) => pp.items.push(newItem({ name: pp.mode === 'equal' && !pp.items.length ? '總額' : '', kind: pp.mode === 'mains' ? 'main' : 'shared', sharedBy: pp.mode === 'mains' ? [] : 'all' })))}
              >
                ＋ 加一項
              </button>
            </div>
            {result.unassigned.length > 0 && <p className="small danger-text">⚠️ 有 {result.unassigned.length} 項還沒指定給誰，先不算進總額。</p>}
          </section>

          {/* Extras */}
          <section className="card stack">
            <div className="section-title">🧂 額外費用 / 折扣</div>
            <div className="stack-s">
              {p.extras.map((ex) => (
                <ExtraRow key={ex.id} extra={ex} p={p} set={set} />
              ))}
            </div>
            <div className="chip-row">
              {(
                [
                  ['🧾', '服務費', 'percent', 10, 'proportional'],
                  ['🛵', '外送費', 'fixed', 0, 'equal'],
                  ['🏷️', '折扣', 'fixed', 0, 'proportional'],
                  ['💸', '小費', 'fixed', 0, 'equal'],
                ] as [string, string, Extra['type'], number, Extra['split']][]
              ).map(([emoji, name, type, value, split]) => (
                <button key={name} type="button" className="chip" onClick={() => set((pp) => pp.extras.push({ id: uid(), emoji, name, type, value, split }))}>
                  ＋ {emoji} {name}
                </button>
              ))}
            </div>
          </section>

          <section className="card stack">
            <div className="section-title">📌 備註</div>
            <textarea className="input textarea" rows={2} placeholder="例如：小明說下次請客" value={p.note ?? ''} onChange={(e) => set((pp) => (pp.note = e.target.value))} />
          </section>
        </main>
      ) : (
        <ResultView p={p} base={base} set={set} />
      )}

      {tab === 'items' && (
        <div className="bottom-bar">
          <div>
            <div className="bottom-bar__label">總計</div>
            <div className="bottom-bar__value">
              {fmtMoney(result.grandTotalRounded, p.currency)}
              {result.baseGrandTotal != null && foreign && <span className="bottom-bar__base"> ≈ {fmtMoney(result.baseGrandTotal, base)}</span>}
            </div>
          </div>
          <button type="button" className="btn btn--primary btn--lg" onClick={() => navigate(`/p/${p.id}/result`, true)}>
            算給我看 ✨
          </button>
        </div>
      )}

      {/* Sheets */}
      <Sheet open={emojiOpen} onClose={() => setEmojiOpen(false)} title="換個圖示">
        <EmojiPicker
          value={p.emoji}
          options={PROJECT_EMOJIS}
          onChange={(e) => {
            set((pp) => (pp.emoji = e))
            setEmojiOpen(false)
          }}
        />
      </Sheet>

      <PeopleSheet open={peopleOpen} onClose={() => setPeopleOpen(false)} p={p} friends={data.friends} me={data.me} set={set} onSaveFriend={(f) => update((d) => d.friends.push(f))} />

      <Sheet open={!!editPerson} onClose={() => setEditPerson(null)} title="這位是…">
        {editPerson && (
          <div className="stack">
            <PersonEditor person={editPerson} title="TA" onChange={setEditPerson} />
            <div className="row gap wrap">
              <button
                type="button"
                className={`btn ${p.payerId === editPerson.id ? 'btn--butter' : 'btn--ghost'} grow`}
                onClick={() => {
                  set((pp) => (pp.payerId = editPerson.id))
                  showToast(`${editPerson.name} 是代墊的人`, '⭐')
                }}
              >
                ⭐ {p.payerId === editPerson.id ? '就是 TA 代墊' : '設為代墊者'}
              </button>
              {p.people.length > 1 && (
                <button
                  type="button"
                  className="btn btn--ghost btn--danger-text"
                  onClick={() => {
                    set((pp) => {
                      pp.people = pp.people.filter((x) => x.id !== editPerson.id)
                      if (pp.payerId === editPerson.id) pp.payerId = pp.people[0].id
                      for (const it of pp.items) if (it.sharedBy !== 'all') it.sharedBy = it.sharedBy.filter((x) => x !== editPerson.id)
                      delete pp.settled[editPerson.id]
                    })
                    setEditPerson(null)
                  }}
                >
                  移出這餐
                </button>
              )}
            </div>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!editPerson.name.trim()}
              onClick={() => {
                set((pp) => {
                  const i = pp.people.findIndex((x) => x.id === editPerson.id)
                  if (i >= 0) pp.people[i] = editPerson
                })
                if (editPerson.id === data.me.id) update((d) => (d.me = editPerson))
                else if (data.friends.some((f) => f.id === editPerson.id)) update((d) => (d.friends = d.friends.map((f) => (f.id === editPerson.id ? editPerson : f))))
                setEditPerson(null)
              }}
            >
              完成
            </button>
          </div>
        )}
      </Sheet>

      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} onImport={onImport} />

      <Sheet open={menuOpen} onClose={() => { setMenuOpen(false); setConfirmDelete(false) }} title={p.name || '未命名聚餐'}>
        <div className="stack">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              const c = duplicateProject(p.id)
              setMenuOpen(false)
              if (c) navigate(`/p/${c.id}`, true)
            }}
          >
            📄 複製成新帳本
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              set((pp) => (pp.settled = {}))
              setMenuOpen(false)
              showToast('已重設收款狀態', '↩️')
            }}
          >
            ↩️ 重設收款狀態
          </button>
          {!confirmDelete ? (
            <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => setConfirmDelete(true)}>
              🗑 刪除這個帳本
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                deleteProject(p.id)
                navigate('/', true)
              }}
            >
              確定刪除（救不回來喔）
            </button>
          )}
        </div>
      </Sheet>
    </div>
  )
}

function switchMode(_p: Project, mode: SplitMode, set: (fn: (p: Project) => void) => void) {
  set((pp) => {
    pp.mode = mode
    // Leaving "equal": drop the untouched 總額 placeholder so the list starts clean.
    if (mode !== 'equal') pp.items = pp.items.filter((it) => !(it.name === '總額' && it.price === 0))
    if (mode === 'equal' && pp.items.length === 0) pp.items.push(newItem({ name: '總額', sharedBy: 'all', kind: 'shared' }))
    if (mode === 'mains') {
      for (const it of pp.items) {
        if (it.sharedBy !== 'all' && it.sharedBy.length === 1) it.kind = 'main'
        else it.kind = 'shared'
      }
    }
  })
}

/* ---------------- Rate row ---------------- */

function RateRow({ p, base, set }: { p: Project; base: string; set: (fn: (p: Project) => void) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const showToast = useStore((s) => s.showToast)
  const meta = currencyMeta(p.currency)
  const load = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await fetchRate(p.currency, base, p.date)
      set((pp) => {
        pp.rate = Number(r.rate.toPrecision(6))
        pp.rateDate = r.date
        pp.rateSource = 'api'
      })
      showToast(r.date === p.date ? '抓到當天匯率' : `用 ${r.date} 的匯率`, '💱')
    } catch (e) {
      setErr('抓不到匯率，' + (navigator.onLine ? '請稍後再試或手動輸入' : '目前離線'))
      void e
    } finally {
      setBusy(false)
    }
  }
  // auto-fetch once when a foreign currency is picked without a rate
  const fetchedFor = useRef<string>('')
  useEffect(() => {
    const key = p.currency + p.date
    if (p.rate == null && fetchedFor.current !== key && navigator.onLine) {
      fetchedFor.current = key
      load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.currency, p.date])
  return (
    <div className="stack-s">
      <div className="rate-row">
        <span className="rate-row__eq">
          1 {p.currency} =
        </span>
        <MoneyInput
          value={p.rate ?? 0}
          placeholder="匯率"
          onChange={(n) =>
            set((pp) => {
              pp.rate = n || null
              pp.rateSource = 'manual'
              pp.rateDate = undefined
            })
          }
        />
        <span className="rate-row__eq">{base}</span>
        <button type="button" className="btn btn--sm btn--mint" disabled={busy} onClick={load}>
          {busy ? '抓取中…' : '📅 抓當天匯率'}
        </button>
      </div>
      <p className="muted small">
        {err
          ? err
          : p.rate == null
            ? `輸入 1 ${meta.name} 換多少 ${base}，或按右邊自動抓 ${p.date} 的匯率`
            : p.rateSource === 'api'
              ? `匯率來源：${p.rateDate} 市場匯率（會跟銀行牌價略有差異）`
              : '手動輸入的匯率'}
      </p>
    </div>
  )
}

/* ---------------- Item row ---------------- */

function ItemRow({ item, p, set }: { item: Item; p: Project; set: (fn: (p: Project) => void) => void }) {
  const patch = (fn: (it: Item) => void) =>
    set((pp) => {
      const it = pp.items.find((x) => x.id === item.id)
      if (it) fn(it)
    })
  const remove = () => set((pp) => (pp.items = pp.items.filter((x) => x.id !== item.id)))
  const sharers = resolveSharers(item, p)
  const isAll = item.sharedBy === 'all'
  const toggle = (id: string) =>
    patch((it) => {
      if (p.mode === 'mains' && it.kind === 'main') {
        it.sharedBy = [id]
        return
      }
      const cur = it.sharedBy === 'all' ? p.people.map((x) => x.id) : [...it.sharedBy]
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
      it.sharedBy = next.length === p.people.length ? 'all' : next
    })
  const selectAll = () => patch((it) => (it.sharedBy = 'all'))

  return (
    <div className="item-row">
      <div className="item-row__main">
        <input className="input grow" placeholder="品項" value={item.name} onChange={(e) => patch((it) => (it.name = e.target.value))} />
        {p.mode !== 'equal' && (
          <input className="input input--qty" inputMode="numeric" value={item.qty} title="數量" onChange={(e) => patch((it) => (it.qty = Math.max(1, Number(e.target.value) || 1)))} />
        )}
        <MoneyInput value={item.price} onChange={(n) => patch((it) => (it.price = n))} autoFocus={!item.name && !item.price} />
        <button type="button" className="icon-btn icon-btn--sm" onClick={remove} aria-label="刪除">
          ✕
        </button>
      </div>
      {p.mode !== 'equal' && (
        <div className="item-row__who">
          {p.mode === 'mains' && (
            <button
              type="button"
              className={`kind-toggle ${item.kind === 'main' ? 'is-main' : 'is-shared'}`}
              onClick={() =>
                patch((it) => {
                  it.kind = it.kind === 'main' ? 'shared' : 'main'
                  it.sharedBy = it.kind === 'main' ? (it.sharedBy !== 'all' && it.sharedBy.length ? [it.sharedBy[0]] : []) : 'all'
                })
              }
            >
              {item.kind === 'main' ? '🍛 主餐' : '🥗 共享'}
            </button>
          )}
          <div className="who-chips">
            {p.people.map((person) => (
              <Avatar key={person.id} person={person} size={30} active={sharers.includes(person.id)} onClick={() => toggle(person.id)} />
            ))}
            {!(p.mode === 'mains' && item.kind === 'main') && (
              <button type="button" className={`chip chip--xs ${isAll ? 'is-on' : ''}`} onClick={selectAll}>
                全部
              </button>
            )}
          </div>
          {item.qty > 1 && <span className="muted small">= {fmtMoney(itemTotal(item), p.currency)}</span>}
          {sharers.length === 0 && <span className="danger-text small">選一下誰的</span>}
        </div>
      )}
    </div>
  )
}

/* ---------------- Extra row ---------------- */

function ExtraRow({ extra, p, set }: { extra: Extra; p: Project; set: (fn: (p: Project) => void) => void }) {
  const patch = (fn: (e: Extra) => void) =>
    set((pp) => {
      const e = pp.extras.find((x) => x.id === extra.id)
      if (e) fn(e)
    })
  return (
    <div className="item-row">
      <div className="item-row__main">
        <span className="extra-emoji">{extra.emoji}</span>
        <input className="input grow" value={extra.name} onChange={(e) => patch((x) => (x.name = e.target.value))} />
        <button type="button" className="chip chip--xs" onClick={() => patch((x) => (x.type = x.type === 'percent' ? 'fixed' : 'percent'))} title="切換 % / 金額">
          {extra.type === 'percent' ? '%' : currencyMeta(p.currency).code}
        </button>
        <MoneyInput value={extra.value} onChange={(n) => patch((x) => (x.value = n))} />
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => set((pp) => (pp.extras = pp.extras.filter((x) => x.id !== extra.id)))} aria-label="刪除">
          ✕
        </button>
      </div>
      <div className="item-row__who">
        <span className="muted small">分法：</span>
        <button type="button" className={`chip chip--xs ${extra.split === 'proportional' ? 'is-on' : ''}`} onClick={() => patch((x) => (x.split = 'proportional'))}>
          按各自金額比例
        </button>
        <button type="button" className={`chip chip--xs ${extra.split === 'equal' ? 'is-on' : ''}`} onClick={() => patch((x) => (x.split = 'equal'))}>
          每人平均
        </button>
        {extra.name === '折扣' && extra.value > 0 && <span className="muted small">（折扣請輸入負數，例如 -50）</span>}
      </div>
    </div>
  )
}

/* ---------------- People sheet ---------------- */

function PeopleSheet({ open, onClose, p, friends, me, set, onSaveFriend }: { open: boolean; onClose: () => void; p: Project; friends: Person[]; me: Person; set: (fn: (p: Project) => void) => void; onSaveFriend: (f: Person) => void }) {
  const [name, setName] = useState('')
  const [remember, setRemember] = useState(true)
  const inProject = new Set(p.people.map((x) => x.id))
  const candidates = [me, ...friends].filter((f) => !inProject.has(f.id))
  const add = (person: Person) => set((pp) => pp.people.push(person))
  const addNew = () => {
    const n = name.trim()
    if (!n) return
    const person = newPerson(n, p.people.length + friends.length)
    add(person)
    if (remember) onSaveFriend(person)
    setName('')
  }
  return (
    <Sheet open={open} onClose={onClose} title="加人">
      <div className="stack">
        {candidates.length > 0 && (
          <>
            <div className="label">點一下加入</div>
            <div className="friend-grid">
              {candidates.map((f) => (
                <button key={f.id} type="button" className="friend" onClick={() => add(f)}>
                  <Avatar person={f} size={48} />
                  <span>{f.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="label">或打新名字</div>
        <div className="row gap">
          <input className="input grow" placeholder="名字" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNew()} />
          <button type="button" className="btn btn--primary" disabled={!name.trim()} onClick={addNew}>
            加入
          </button>
        </div>
        <label className="row gap-s center small muted">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 存成常用朋友
        </label>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          好了
        </button>
      </div>
    </Sheet>
  )
}

/* ---------------- Result ---------------- */

function ResultView({ p, base, set }: { p: Project; base: string; set: (fn: (p: Project) => void) => void }) {
  const result = useMemo(() => computeSplit(p), [p])
  const showToast = useStore((s) => s.showToast)
  const [open, setOpen] = useState<string | null>(null)
  const [confetti, setConfetti] = useState(false)
  const foreign = p.currency !== base
  const others = result.people.filter((r) => !r.isPayer)
  const allSettled = others.length > 0 && others.every((r) => r.settled)
  const payer = p.people.find((x) => x.id === p.payerId)

  const toggleSettled = (id: string) => {
    const willBeAll = others.every((r) => (r.person.id === id ? !r.settled : r.settled))
    set((pp) => (pp.settled[id] = !pp.settled[id]))
    if (willBeAll) {
      setConfetti(true)
      setTimeout(() => setConfetti(false), 2600)
    }
  }

  const share = async () => {
    const text = summaryText(p, result, base)
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        showToast('已複製，貼到 LINE 吧', '📋')
      }
    } catch {
      /* cancelled */
    }
  }

  if (p.items.length === 0 || result.grandTotal === 0) {
    return (
      <main className="stack">
        <Empty mood="wow" title="還沒有東西可以算" hint="先回「明細」輸入金額吧。">
          <button type="button" className="btn btn--primary" onClick={() => navigate(`/p/${p.id}/items`, true)}>
            去輸入
          </button>
        </Empty>
      </main>
    )
  }

  return (
    <main className="stack">
      <Confetti on={confetti} />
      <div className={`card card--${allSettled ? 'mint' : 'pink'} total-card`}>
        <div>
          <div className="total-card__label">{allSettled ? '全部收齊了！' : '這餐總共'}</div>
          <div className="total-card__value">{fmtMoney(result.grandTotalRounded, p.currency)}</div>
          {foreign && result.baseGrandTotal != null && <div className="total-card__base">≈ {fmtMoney(result.baseGrandTotal, base)}</div>}
          {foreign && result.baseGrandTotal == null && <div className="total-card__base">還沒有匯率，回明細設定一下</div>}
          {payer && (
            <div className="total-card__payer">
              {payer.emoji} {payer.name} 代墊 · {others.filter((r) => r.settled).length}/{others.length} 人已還
            </div>
          )}
        </div>
        <div className="total-card__emoji">{allSettled ? '🎉' : '🧾'}</div>
      </div>

      <div className="stack-s">
        {result.people.map((r) => {
          const expanded = open === r.person.id
          return (
            <div key={r.person.id} className={`card person-result c-border-${r.person.color} ${r.settled ? 'is-settled' : ''}`}>
              <button type="button" className="person-result__head" onClick={() => setOpen(expanded ? null : r.person.id)}>
                <Avatar person={r.person} size={44} />
                <div className="grow left">
                  <div className="strong">
                    {r.person.name} {r.isPayer && <span className="pill pill--butter">⭐ 代墊</span>}
                  </div>
                  <div className="muted small">{r.lines.length} 項{r.extras.length ? ` + ${r.extras.length} 筆額外` : ''}</div>
                </div>
                <div className="right">
                  <div className="person-result__amt">{fmtMoney(r.totalRounded, p.currency)}</div>
                  {foreign && r.baseTotal != null && <div className="muted small">≈ {fmtMoney(r.baseTotal, base)}</div>}
                </div>
              </button>
              {expanded && (
                <div className="person-result__lines">
                  {r.lines.map((l, i) => (
                    <div key={i} className="line">
                      <span>
                        {l.name || '（未命名）'}
                        {l.sharers > 1 && <span className="muted"> ÷{l.sharers}</span>}
                      </span>
                      <span>{fmtMoney(l.amount, p.currency, { compact: true })}</span>
                    </div>
                  ))}
                  {r.extras.map((e, i) => (
                    <div key={'e' + i} className="line line--extra">
                      <span>
                        {e.emoji} {e.name}
                      </span>
                      <span>{fmtMoney(e.amount, p.currency, { compact: true })}</span>
                    </div>
                  ))}
                </div>
              )}
              {!r.isPayer && (
                <button type="button" className={`btn btn--sm ${r.settled ? 'btn--mint' : 'btn--ghost'} person-result__settle`} onClick={() => toggleSettled(r.person.id)}>
                  {r.settled ? '✓ 已還我' : '還沒還'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <button type="button" className="btn btn--primary btn--lg" onClick={share}>
        📤 分享結果
      </button>
      <p className="muted small center-text">會產生一段文字，直接貼到群組就好。</p>
    </main>
  )
}
