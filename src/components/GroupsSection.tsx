import { useState } from 'react'
import { useStore, uid } from '../store'
import { PROJECT_EMOJIS, type Group, type SplitMode } from '../lib/types'

const NO_GROUPS: Group[] = []
import { Avatar, EmojiPicker, Segmented, Sheet } from './ui'

const MODES: { value: SplitMode; label: string }[] = [
  { value: 'equal', label: '均攤' },
  { value: 'items', label: '各點各的' },
  { value: 'mains', label: '個人+共享' },
]

export function GroupEditor({ group, onChange }: { group: Group; onChange: (g: Group) => void }) {
  const me = useStore((s) => s.data.me)
  const friends = useStore((s) => s.data.friends)
  const toggle = (id: string) => onChange({ ...group, personIds: group.personIds.includes(id) ? group.personIds.filter((x) => x !== id) : [...group.personIds, id] })
  return (
    <div className="stack">
      <input className="input" placeholder="組合名字，例：週五拉麵團" value={group.name} autoFocus onChange={(e) => onChange({ ...group, name: e.target.value })} />
      <div className="label">圖示</div>
      <EmojiPicker value={group.emoji} options={PROJECT_EMOJIS} onChange={(emoji) => onChange({ ...group, emoji })} />
      <div className="label">成員（點一下選取）</div>
      {friends.length === 0 && <p className="muted small">還沒有常用朋友，先在上面加幾個吧。</p>}
      <div className="friend-grid">
        {[me, ...friends].map((f) => (
          <button key={f.id} type="button" className={`friend ${group.personIds.includes(f.id) ? 'is-on' : ''}`} onClick={() => toggle(f.id)}>
            <Avatar person={f} size={48} active={group.personIds.includes(f.id)} />
            <span>{f.name}</span>
          </button>
        ))}
      </div>
      <div className="label">預設分法</div>
      <Segmented<SplitMode> value={group.mode} options={MODES} onChange={(mode) => onChange({ ...group, mode })} />
    </div>
  )
}

export default function GroupsSection() {
  const groups = useStore((s) => s.data.groups ?? NO_GROUPS)
  const me = useStore((s) => s.data.me)
  const update = useStore((s) => s.update)
  const [editing, setEditing] = useState<Group | null>(null)
  const exists = !!editing && groups.some((g) => g.id === editing.id)
  return (
    <section className="card stack">
      <div className="section-title">🍱 常用組合</div>
      <p className="muted small">固定的那群人存起來，開新帳本時一鍵帶入成員和分法。</p>
      <div className="friend-grid">
        {groups.map((g) => (
          <button key={g.id} type="button" className="friend" onClick={() => setEditing(g)}>
            <span className="avatar c-lavender" style={{ width: 48, height: 48, fontSize: 24 }}>
              {g.emoji}
            </span>
            <span>
              {g.name}
              <span className="muted"> · {g.personIds.length}</span>
            </span>
          </button>
        ))}
        <button type="button" className="friend friend--add" onClick={() => setEditing({ id: uid(), name: '', emoji: '🍜', personIds: [me.id], mode: 'equal' })}>
          <span className="avatar avatar--dashed" style={{ width: 48, height: 48 }}>
            ＋
          </span>
          <span>新增</span>
        </button>
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="常用組合" tall>
        {editing && (
          <div className="stack">
            <GroupEditor group={editing} onChange={setEditing} />
            <div className="row gap">
              {exists && (
                <button
                  type="button"
                  className="btn btn--ghost btn--danger-text"
                  onClick={() => {
                    update((d) => (d.groups = (d.groups ?? []).filter((g) => g.id !== editing.id)))
                    setEditing(null)
                  }}
                >
                  刪除
                </button>
              )}
              <button
                type="button"
                className="btn btn--primary grow"
                disabled={!editing.name.trim() || editing.personIds.length === 0}
                onClick={() => {
                  update((d) => {
                    const list = d.groups ?? []
                    const i = list.findIndex((g) => g.id === editing.id)
                    if (i >= 0) list[i] = editing
                    else list.push(editing)
                    d.groups = list
                  })
                  setEditing(null)
                }}
              >
                儲存
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </section>
  )
}
