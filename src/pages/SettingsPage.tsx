import { useRef, useState } from 'react'
import { useStore, newPerson } from '../store'
import { navigate } from '../router'
import { CURRENCIES, PALETTE, PERSON_EMOJIS, type Person } from '../lib/types'
import { Avatar, EmojiPicker, Sheet } from '../components/ui'
import PinPad from '../components/PinPad'
import type { LockDelay } from '../lib/storage'
import SyncSection from '../components/SyncSection'
import PayInfoSection from '../components/PayInfoSection'
import GroupsSection from '../components/GroupsSection'
import UpdateSection from '../components/UpdateSection'
import PushSection from '../components/PushSection'

export function PersonEditor({ person, onChange, onDelete, title }: { person: Person; onChange: (p: Person) => void; onDelete?: () => void; title: string }) {
  return (
    <div className="stack">
      <div className="row gap center">
        <Avatar person={person} size={56} />
        <input className="input grow" value={person.name} placeholder="名字" autoFocus onChange={(e) => onChange({ ...person, name: e.target.value })} />
      </div>
      <div className="label">{title}的頭像</div>
      <EmojiPicker value={person.emoji} options={PERSON_EMOJIS} onChange={(emoji) => onChange({ ...person, emoji })} />
      <div className="label">顏色</div>
      <div className="row gap-s wrap">
        {PALETTE.map((c) => (
          <button key={c} type="button" className={`swatch c-${c} ${person.color === c ? 'is-on' : ''}`} onClick={() => onChange({ ...person, color: c })} aria-label={c} />
        ))}
      </div>
      {onDelete && (
        <button type="button" className="btn btn--ghost btn--danger-text" onClick={onDelete}>
          🗑 刪除這位朋友
        </button>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const data = useStore((s) => s.data)
  const prefs = useStore((s) => s.prefs)
  const encrypted = useStore((s) => s.encrypted)
  const setPrefs = useStore((s) => s.setPrefs)
  const setPin = useStore((s) => s.setPin)
  const removePin = useStore((s) => s.removePin)
  const update = useStore((s) => s.update)
  const importData = useStore((s) => s.importData)
  const wipe = useStore((s) => s.wipe)
  const showToast = useStore((s) => s.showToast)
  const setTutorialOpen = useStore((s) => s.setTutorialOpen)

  const [pinStep, setPinStep] = useState<null | 'new' | 'confirm'>(null)
  const [pinFirst, setPinFirst] = useState('')
  const [shake, setShake] = useState(0)
  const [editing, setEditing] = useState<Person | null>(null)
  const [editingMe, setEditingMe] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const onPin = async (pin: string) => {
    if (pinStep === 'new') {
      setPinFirst(pin)
      setPinStep('confirm')
    } else if (pinStep === 'confirm') {
      if (pin === pinFirst) {
        await setPin(pin)
        setPinStep(null)
        showToast('已上鎖，資料已加密', '🔐')
      } else {
        setShake((s) => s + 1)
        setPinStep('new')
        showToast('兩次不一樣，再來一次', '🙈')
      }
    }
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `banban-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const onImportFile = async (f: File | undefined) => {
    if (!f) return
    try {
      const json = JSON.parse(await f.text())
      if (!json || !Array.isArray(json.projects)) throw new Error('格式不對')
      importData(json)
      showToast(`匯入 ${json.projects.length} 個帳本`, '📦')
    } catch (e) {
      showToast('匯入失敗：' + (e instanceof Error ? e.message : '未知錯誤'), '😵')
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="返回">
          ←
        </button>
        <h1 className="topbar__title">設定</h1>
        <span style={{ width: 40 }} />
      </header>

      <main className="stack">
        <section className="card stack">
          <div className="section-title">🐥 我自己</div>
          <button type="button" className="row gap center list-row" onClick={() => setEditingMe(true)}>
            <Avatar person={data.me} size={44} />
            <div className="grow left">
              <div className="strong">{data.me.name}</div>
              <div className="muted small">預設代墊者，會自動加進每個帳本</div>
            </div>
            <span className="muted">›</span>
          </button>
        </section>

        <section className="card stack">
          <div className="section-title">🔐 隱私鎖</div>
          <p className="muted small">開啟後，所有帳本會用你的 PIN 加密存在這台裝置上。沒有 PIN 就打不開，連瀏覽器儲存空間裡看到的也只是亂碼。</p>
          {!encrypted ? (
            <button type="button" className="btn btn--primary" onClick={() => setPinStep('new')}>
              設定 PIN 上鎖
            </button>
          ) : (
            <>
              <div className="row gap wrap">
                <button type="button" className="btn btn--ghost" onClick={() => setPinStep('new')}>
                  更換 PIN
                </button>
                <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => removePin().then(() => showToast('已解除上鎖', '🔓'))}>
                  解除上鎖
                </button>
              </div>
              <div className="label">切到背景多久後自動上鎖</div>
              <div className="chip-row">
                {(
                  [
                    [0, '立刻'],
                    [60, '1 分鐘'],
                    [300, '5 分鐘'],
                    [900, '15 分鐘'],
                  ] as [LockDelay, string][]
                ).map(([v, l]) => (
                  <button key={v} type="button" className={`chip ${prefs.lockDelay === v ? 'is-on' : ''}`} onClick={() => setPrefs({ lockDelay: v })}>
                    {l}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <SyncSection />
        <PushSection />
        <PayInfoSection />

        <section className="card stack">
          <div className="section-title">🎨 外觀</div>
          <div className="chip-row">
            {(
              [
                ['system', '🌗 跟系統'],
                ['light', '☀️ 淺色'],
                ['dark', '🌙 深色'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} type="button" className={`chip ${prefs.theme === v ? 'is-on' : ''}`} onClick={() => setPrefs({ theme: v })}>
                {l}
              </button>
            ))}
          </div>
        </section>

        <section className="card stack">
          <div className="section-title">💱 我的主要幣別</div>
          <p className="muted small">外幣帳本會換算成這個幣別顯示。</p>
          <select className="input" value={data.baseCurrency} onChange={(e) => update((d) => (d.baseCurrency = e.target.value))}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.code} {c.name}
              </option>
            ))}
          </select>
        </section>

        <section className="card stack">
          <div className="section-title">👯 常用朋友</div>
          {data.friends.length === 0 && <p className="muted small">存起來之後，開新帳本時點一下就能加人。</p>}
          <div className="friend-grid">
            {data.friends.map((f) => (
              <button key={f.id} type="button" className="friend" onClick={() => setEditing(f)}>
                <Avatar person={f} size={48} />
                <span>{f.name}</span>
              </button>
            ))}
            <button type="button" className="friend friend--add" onClick={() => setEditing(newPerson('', data.friends.length))}>
              <span className="avatar avatar--dashed" style={{ width: 48, height: 48 }}>
                ＋
              </span>
              <span>新增</span>
            </button>
          </div>
        </section>

        <GroupsSection />

        <section className="card stack">
          <div className="section-title">📦 備份與還原</div>
          <p className="muted small">匯出成 JSON 檔存好，換手機時再匯入。備份檔是明文的，請自己保管。</p>
          <div className="row gap wrap">
            <button type="button" className="btn btn--ghost" onClick={exportJson}>
              ⬇️ 匯出備份
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
              ⬆️ 匯入備份
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onImportFile(e.target.files?.[0])} />
          </div>
        </section>

        <UpdateSection />

        <section className="card stack">
          <div className="section-title">🧹 清除</div>
          {!confirmWipe ? (
            <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => setConfirmWipe(true)}>
              清除所有資料
            </button>
          ) : (
            <div className="stack">
              <p className="small">確定嗎？所有帳本、朋友、PIN 都會消失，而且救不回來。</p>
              <div className="row gap">
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmWipe(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={async () => {
                    await wipe()
                    setConfirmWipe(false)
                    showToast('已全部清除', '🧹')
                  }}
                >
                  確定清除
                </button>
              </div>
            </div>
          )}
        </section>

        <p className="muted small center-text">
          <button type="button" className="link" onClick={() => setTutorialOpen(true)}>
            📖 重看新手教學
          </button>
        </p>
        <p className="muted small center-text">
          반반 BanBan · 資料存在你的裝置，同步時先加密 · <a href="https://github.com/chung223/share-money" target="_blank" rel="noreferrer">GitHub</a>
        </p>
      </main>

      <Sheet open={pinStep !== null} onClose={() => setPinStep(null)} title={pinStep === 'confirm' ? '再輸入一次確認' : '設定 4 位數 PIN'}>
        <p className="muted small center-text">PIN 不會被存起來，忘記就只能清除資料重來。</p>
        <PinPad key={pinStep ?? 'x'} onComplete={onPin} shake={shake} />
      </Sheet>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="朋友">
        {editing && (
          <div className="stack">
            <PersonEditor
              person={editing}
              title="朋友"
              onChange={setEditing}
              onDelete={
                data.friends.some((f) => f.id === editing.id)
                  ? () => {
                      update((d) => (d.friends = d.friends.filter((f) => f.id !== editing.id)))
                      setEditing(null)
                    }
                  : undefined
              }
            />
            <button
              type="button"
              className="btn btn--primary"
              disabled={!editing.name.trim()}
              onClick={() => {
                update((d) => {
                  const i = d.friends.findIndex((f) => f.id === editing.id)
                  if (i >= 0) d.friends[i] = editing
                  else d.friends.push(editing)
                })
                setEditing(null)
              }}
            >
              儲存
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={editingMe} onClose={() => setEditingMe(false)} title="我自己">
        <div className="stack">
          <PersonEditor person={data.me} title="我" onChange={(p) => update((d) => (d.me = p))} />
          <button type="button" className="btn btn--primary" onClick={() => setEditingMe(false)}>
            完成
          </button>
        </div>
      </Sheet>
    </div>
  )
}
