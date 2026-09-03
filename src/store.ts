import { create } from 'zustand'
import type { AppData, Extra, Item, Person, Project, SplitMode, Trip } from './lib/types'
import { PALETTE, PERSON_EMOJIS } from './lib/types'
import { api, apiBase, applyShareEvents, canon, decryptWithKey, deriveSyncKeys, encryptWithKey, forUpload, generateSecret, mergeData, parseSecret, SyncError, type SyncKeys } from './lib/sync'
import { buildSnapshot, decryptNote, encryptSnapshot, generateShareKey } from './lib/share'
import { clearSyncMeta, loadSyncMeta, saveSyncMeta } from './lib/syncMeta'
import { categoryOf } from './lib/category'
import {
  createPinSession,
  loadPlain,
  loadPrefs,
  persist,
  readBlob,
  savePrefs,
  unlockWithPin,
  wipeAll,
  type LocalPrefs,
  type Session,
} from './lib/storage'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export function today() {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

function defaultData(): AppData {
  return {
    version: 1,
    me: { id: 'me', name: '我', emoji: '🐥', color: 'butter' },
    friends: [],
    projects: [],
    baseCurrency: 'TWD',
  }
}

export function newPerson(name: string, i = 0): Person {
  return {
    id: uid(),
    name,
    emoji: PERSON_EMOJIS[(i + 1) % PERSON_EMOJIS.length],
    color: PALETTE[(i + 1) % PALETTE.length],
  }
}

export function newProject(me: Person, baseCurrency: string): Project {
  const now = Date.now()
  return {
    id: uid(),
    name: '',
    emoji: '🍜',
    date: today(),
    createdAt: now,
    updatedAt: now,
    currency: baseCurrency,
    rate: null,
    mode: 'equal',
    payerId: me.id,
    people: [me],
    items: [{ id: uid(), name: '總額', price: 0, qty: 1, sharedBy: 'all', kind: 'shared' }],
    extras: [],
    settled: {},
  }
}

export function newItem(partial: Partial<Item> = {}): Item {
  return { id: uid(), name: '', price: 0, qty: 1, sharedBy: 'all', kind: 'shared', ...partial }
}

export interface SyncState {
  status: 'off' | 'idle' | 'syncing' | 'offline' | 'error'
  lastSyncAt: number | null
  error: string | null
  dirty: boolean
}

interface State {
  ready: boolean
  locked: boolean
  encrypted: boolean
  prefs: LocalPrefs
  data: AppData
  session: Session
  toast: { id: number; text: string; emoji?: string } | null
  sync: SyncState
  tutorialOpen: boolean
  setTutorialOpen: (v: boolean) => void

  init: () => Promise<void>
  unlock: (pin: string) => Promise<boolean>
  lock: () => void
  setPin: (pin: string) => Promise<void>
  removePin: () => Promise<void>
  setPrefs: (p: Partial<LocalPrefs>) => void
  update: (fn: (d: AppData) => void) => void
  updateProject: (id: string, fn: (p: Project) => void, touch?: boolean) => void
  addProject: (groupId?: string, category?: Project['category'], tripId?: string) => Project
  addTrip: (name: string, emoji: string) => Trip
  updateTrip: (id: string, fn: (t: Trip) => void, touch?: boolean) => void
  deleteTrip: (id: string, deleteProjects: boolean) => void
  deleteProject: (id: string) => void
  duplicateProject: (id: string) => Project | null
  importData: (data: AppData) => void
  wipe: () => Promise<void>
  showToast: (text: string, emoji?: string) => void

  enableSync: (secret?: string) => Promise<void>
  disableSync: (deleteRemote: boolean) => Promise<void>
  syncNow: (opts?: { quiet?: boolean }) => Promise<void>
  createShare: (projectId: string, days: number, ogTitle?: string | null) => Promise<string>
  revokeShare: (projectId: string) => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(get: () => State) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const s = get()
    if (s.locked) return
    persist(s.data, s.session).catch((e) => console.error('save failed', e))
  }, 150)
}

// ---- sync plumbing (module-level so timers survive re-renders) ----
let changeSeq = loadSyncMeta().dirty ? 1 : 0
let pushedSeq = 0
let syncing = false
let syncAgain = false
let pushTimer: ReturnType<typeof setTimeout> | null = null
const keyCache = new Map<string, Promise<SyncKeys>>()
function keysFor(secret: string) {
  let k = keyCache.get(secret)
  if (!k) {
    k = deriveSyncKeys(secret)
    keyCache.set(secret, k)
  }
  return k
}
function markDirty(get: () => State) {
  changeSeq += 1
  const meta = loadSyncMeta()
  saveSyncMeta({ ...meta, dirty: true })
  const s = get()
  if (!s.data.sync || s.sync.status === 'off') return
  if (!s.sync.dirty) useStore.setState({ sync: { ...s.sync, dirty: true } })
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => get().syncNow({ quiet: true }), 2500)
}
function fmtErr(e: unknown) {
  if (e instanceof SyncError) {
    if (e.code === 'network') return '連不上伺服器'
    if (e.code === 'decrypt') return '金鑰對不上，雲端資料解不開'
    if (e.code === 'unauthorized') return '伺服器拒絕了這把金鑰'
    return '伺服器出錯：' + e.message
  }
  return e instanceof Error ? e.message : '未知錯誤'
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  locked: false,
  encrypted: false,
  prefs: loadPrefs(),
  data: defaultData(),
  session: { key: null, salt: null },
  toast: null,
  sync: { status: 'off', lastSyncAt: loadSyncMeta().lastSyncAt, error: null, dirty: loadSyncMeta().dirty },
  tutorialOpen: false,
  setTutorialOpen: (v) => set({ tutorialOpen: v }),

  init: async () => {
    const blob = await readBlob()
    if (!blob) {
      set({ ready: true, locked: false, encrypted: false, data: defaultData() })
      return
    }
    if (blob.enc) {
      set({ ready: true, locked: true, encrypted: true })
      return
    }
    const data = (await loadPlain()) ?? defaultData()
    set({ ready: true, locked: false, encrypted: false, data: { ...defaultData(), ...data } })
    if (data.sync) {
      set({ sync: { ...get().sync, status: 'idle' } })
      get().syncNow({ quiet: true })
    }
  },

  unlock: async (pin) => {
    try {
      const { data, session } = await unlockWithPin(pin)
      set({ data: { ...defaultData(), ...data }, session, locked: false })
      if (data.sync) {
        set({ sync: { ...get().sync, status: 'idle' } })
        get().syncNow({ quiet: true })
      }
      return true
    } catch {
      return false
    }
  },

  lock: () => {
    if (!get().encrypted) return
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      persist(get().data, get().session).catch(() => {})
    }
    set({ locked: true, data: defaultData(), session: { key: null, salt: null } })
  },

  setPin: async (pin) => {
    const session = await createPinSession(pin)
    await persist(get().data, session)
    const prefs = { ...get().prefs, hasPin: true }
    savePrefs(prefs)
    set({ session, encrypted: true, prefs })
  },

  removePin: async () => {
    const session: Session = { key: null, salt: null }
    await persist(get().data, session)
    const prefs = { ...get().prefs, hasPin: false }
    savePrefs(prefs)
    set({ session, encrypted: false, prefs })
  },

  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p }
    savePrefs(prefs)
    set({ prefs })
  },

  update: (fn) => {
    const data = structuredClone(get().data)
    fn(data)
    data.updatedAt = Date.now()
    set({ data })
    scheduleSave(get)
    markDirty(get)
  },

  updateProject: (id, fn, touch = true) => {
    get().update((d) => {
      const p = d.projects.find((x) => x.id === id)
      if (!p) return
      fn(p)
      if (touch) p.updatedAt = Date.now()
    })
  },

  addTrip: (name, emoji) => {
    const now = Date.now()
    const t: Trip = { id: uid(), name, emoji, createdAt: now, updatedAt: now }
    get().update((d) => (d.trips = [t, ...(d.trips ?? [])]))
    return t
  },
  updateTrip: (id, fn, touch = true) => {
    get().update((d) => {
      const t = d.trips?.find((x) => x.id === id)
      if (!t) return
      fn(t)
      if (touch) t.updatedAt = Date.now()
    })
  },
  deleteTrip: (id, deleteProjects) => {
    get().update((d) => {
      d.trips = (d.trips ?? []).filter((t) => t.id !== id)
      d.deleted = { ...(d.deleted ?? {}), ['trip:' + id]: Date.now() }
      for (const p of d.projects) {
        if (p.tripId !== id) continue
        if (deleteProjects) d.deleted[p.id] = Date.now()
        else delete p.tripId
      }
      if (deleteProjects) d.projects = d.projects.filter((p) => p.tripId !== id)
    })
  },
  addProject: (groupId, category, tripId) => {
    const { data } = get()
    const p = newProject(data.me, data.baseCurrency)
    if (tripId) {
      p.tripId = tripId
      // 同一趟旅程的人自動帶入
      const seen = new Set<string>([data.me.id])
      for (const q of data.projects) if (q.tripId === tripId) for (const x of q.people) if (!seen.has(x.id)) { seen.add(x.id); p.people.push(x) }
    }
    if (category) {
      p.category = category
      p.emoji = categoryOf({ emoji: '', category }).emojis[0]
    }
    const g = groupId ? data.groups?.find((x) => x.id === groupId) : undefined
    if (g) {
      const pool = [data.me, ...data.friends]
      p.people = g.personIds.map((id) => pool.find((x) => x.id === id)).filter((x): x is Person => !!x)
      if (!p.people.some((x) => x.id === data.me.id)) p.people.unshift(data.me)
      p.mode = g.mode
      if (!category) p.emoji = g.emoji
      if (g.mode !== 'equal') p.items = []
    }
    get().update((d) => d.projects.unshift(p))
    return p
  },

  deleteProject: (id) => {
    const p = get().data.projects.find((x) => x.id === id)
    if (p?.share && get().data.sync) get().revokeShare(id).catch(() => {})
    get().update((d) => {
      d.projects = d.projects.filter((p) => p.id !== id)
      d.deleted = { ...(d.deleted ?? {}), [id]: Date.now() }
    })
  },

  duplicateProject: (id) => {
    const src = get().data.projects.find((p) => p.id === id)
    if (!src) return null
    const copy: Project = structuredClone(src)
    copy.id = uid()
    copy.name = src.name + '（副本）'
    copy.date = today()
    copy.createdAt = copy.updatedAt = Date.now()
    copy.settled = {}
    get().update((d) => d.projects.unshift(copy))
    return copy
  },

  importData: (data) => {
    set({ data: { ...defaultData(), ...data } })
    scheduleSave(get)
  },

  wipe: async () => {
    await wipeAll()
    clearSyncMeta()
    changeSeq = pushedSeq = 0
    set({ data: defaultData(), session: { key: null, salt: null }, encrypted: false, locked: false, prefs: loadPrefs(), sync: { status: 'off', lastSyncAt: null, error: null, dirty: false } })
  },

  showToast: (text, emoji) => {
    const id = Date.now()
    set({ toast: { id, text, emoji } })
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, 2200)
  },

  // ---------------- sync ----------------

  enableSync: async (secretIn) => {
    const secret = secretIn ? parseSecret(secretIn) : generateSecret()
    if (!secret) throw new Error('金鑰格式不對')
    await keysFor(secret) // validate early
    saveSyncMeta({ version: 0, lastSyncAt: null, dirty: true })
    changeSeq = 1
    pushedSeq = 0
    get().update((d) => (d.sync = { secret, serverUrl: '', enabledAt: Date.now() }))
    set({ sync: { status: 'idle', lastSyncAt: null, error: null, dirty: true } })
    await get().syncNow()
  },

  disableSync: async (deleteRemote) => {
    const cfg = get().data.sync
    if (cfg && deleteRemote) {
      const keys = await keysFor(cfg.secret)
      await api.remove(apiBase(cfg.serverUrl), keys.token)
    }
    if (pushTimer) clearTimeout(pushTimer)
    get().update((d) => {
      delete d.sync
      for (const p of d.projects) delete p.share
    })
    if (pushTimer) clearTimeout(pushTimer)
    clearSyncMeta()
    changeSeq = pushedSeq = 0
    set({ sync: { status: 'off', lastSyncAt: null, error: null, dirty: false } })
  },

  syncNow: async ({ quiet = false } = {}) => {
    const s0 = get()
    const cfg = s0.data.sync
    if (!cfg || s0.locked) return
    if (syncing) {
      syncAgain = true
      return
    }
    syncing = true
    if (pushTimer) {
      clearTimeout(pushTimer)
      pushTimer = null
    }
    set({ sync: { ...get().sync, status: 'syncing', error: null } })
    try {
      const keys = await keysFor(cfg.secret)
      const base = apiBase(cfg.serverUrl)
      const now = Date.now()
      let remote = await api.get(base, keys.token)
      let meta = loadSyncMeta()
      const seqAtStart = changeSeq
      let toastMsg: string | null = null

      for (let attempt = 0; attempt < 4; attempt++) {
        if (get().locked) return
        let data = get().data
        let changed = false
        let remoteData: AppData | null = null

        // 1. pull: merge the server copy when it moved since we last saw it
        if (remote.cipher && remote.version !== meta.version) {
          try {
            remoteData = { ...defaultData(), ...(await decryptWithKey<AppData>(keys.key, remote.cipher)) }
          } catch {
            throw new SyncError('decrypt', 'decrypt')
          }
          data = mergeData(data, remoteData, now)
          changed = true
        }

        // 2. "I paid" taps from share pages
        const eventIds: number[] = []
        if (remote.events.length) {
          data = structuredClone(data)
          // notes are encrypted with the share key; decrypt what we can before applying
          for (const e of remote.events) {
            if (!e.note) continue
            const key = data.projects.find((x) => x.id === e.projectId)?.share?.key
            e.noteText = key ? await decryptNote(key, e.note) : null
          }
          eventIds.push(...applyShareEvents(data, remote.events))
          changed = true
          const paid = remote.events.filter((e) => e.kind === 'paid')
          if (paid.length) {
            const last = paid[paid.length - 1]
            const p = data.projects.find((x) => x.id === last.projectId)
            const who = p?.people.find((x) => x.id === last.personId.split('_')[0])
            toastMsg = who ? `${who.emoji} ${who.name} 說已經轉帳了` + (last.noteText ? `：${last.noteText}` : '') + (paid.length > 1 ? `（共 ${paid.length} 筆）` : '') : null
          }
        }

        // 3. share snapshots: drop ones the server no longer has, re-upload stale ones
        const serverShares = new Map(remote.shares.map((x) => [x.projectId, x]))
        for (const p of data.projects) {
          if (!p.share) continue
          const sv = serverShares.get(p.id)
          if (!sv || sv.expiresAt < now) {
            if (data === get().data) data = structuredClone(data)
            delete data.projects.find((x) => x.id === p.id)!.share
            changed = true
          } else if (p.share.uploadedAt < p.updatedAt) {
            const cipher = await encryptSnapshot(p.share.key, buildSnapshot(p, data.baseCurrency, data.me.name, data.payInfo, data.me.id))
            await api.share(base, keys.token, { projectId: p.id, cipher, expiresAt: p.share.expiresAt, ogTitle: p.share.ogTitle ?? null })
            if (data === get().data) data = structuredClone(data)
            data.projects.find((x) => x.id === p.id)!.share!.uploadedAt = now
            changed = true
          }
        }

        if (changed) {
          if (get().locked) return
          set({ data })
          scheduleSave(get)
        }

        // 4. push when we have local edits, the server is empty, or the merge produced something
        //    the server doesn't have yet (compare content, or two devices would ping-pong versions forever)
        const differs = remoteData ? canon(forUpload(data)) !== canon(remoteData) : changed
        const needPush = changeSeq !== pushedSeq || !remote.cipher || differs
        if (needPush) {
          const cipher = await encryptWithKey(keys.key, forUpload(data))
          const seqBeforePush = changeSeq
          const r = await api.put(base, keys.token, remote.version, cipher)
          if (!r.ok) {
            remote = { ...remote, version: r.version, cipher: r.cipher, events: [] }
            meta = { ...meta, version: meta.version } // keep old version so the next pass merges
            continue
          }
          meta = { version: r.version, lastSyncAt: Date.now(), dirty: changeSeq !== seqBeforePush }
          pushedSeq = seqBeforePush
        } else {
          meta = { version: remote.version, lastSyncAt: Date.now(), dirty: false }
          pushedSeq = seqAtStart
        }
        saveSyncMeta(meta)
        if (eventIds.length) await api.ack(base, keys.token, eventIds)
        break
      }

      set({ sync: { status: 'idle', lastSyncAt: meta.lastSyncAt, error: null, dirty: meta.dirty } })
      if (toastMsg) get().showToast(toastMsg, '💸')
      else if (!quiet) get().showToast('同步完成', '☁️')
    } catch (e) {
      const offline = e instanceof SyncError && e.code === 'network'
      set({ sync: { ...get().sync, status: offline ? 'offline' : 'error', error: fmtErr(e) } })
      if (!quiet) get().showToast(fmtErr(e), offline ? '📴' : '😵')
    } finally {
      syncing = false
      if (syncAgain) {
        syncAgain = false
        get().syncNow({ quiet: true })
      }
    }
  },

  createShare: async (projectId, days, ogTitle) => {
    if (!get().data.sync) await get().enableSync()
    const s = get()
    const cfg = s.data.sync!
    const p = s.data.projects.find((x) => x.id === projectId)
    if (!p) throw new Error('帳本不見了')
    const keys = await keysFor(cfg.secret)
    const key = p.share?.key ?? generateShareKey()
    const expiresAt = Date.now() + days * 86_400_000
    const cipher = await encryptSnapshot(key, buildSnapshot(p, s.data.baseCurrency, s.data.me.name, s.data.payInfo, s.data.me.id))
    const og = ogTitle === undefined ? (p.share?.ogTitle ?? null) : ogTitle
    const r = await api.share(apiBase(cfg.serverUrl), keys.token, { projectId, cipher, expiresAt, ogTitle: og })
    get().updateProject(projectId, (pp) => (pp.share = { id: r.id, key, expiresAt: r.expiresAt, uploadedAt: Date.now(), ogTitle: og }), false)
    return r.id
  },

  revokeShare: async (projectId) => {
    const s = get()
    const p = s.data.projects.find((x) => x.id === projectId)
    const cfg = s.data.sync
    if (p?.share && cfg) {
      const keys = await keysFor(cfg.secret)
      await api.unshare(apiBase(cfg.serverUrl), keys.token, p.share.id)
    }
    get().updateProject(projectId, (pp) => delete pp.share, false)
  },
}))

// Pull when the app comes back to the foreground (another device may have changed things).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const s = useStore.getState()
      if (s.data.sync && !s.locked && s.ready) s.syncNow({ quiet: true })
    }
  })
}

export type { Extra, Item, Person, Project, SplitMode }
