import { create } from 'zustand'
import type { AppData, Extra, Id, Item, Person, Project, SplitMode, Trip } from './lib/types'
import { PALETTE, PERSON_EMOJIS } from './lib/types'
import { api, apiBase, applyShareEvents, canon, decryptWithKey, deriveSyncKeys, encryptWithKey, forUpload, generateSecret, mergeData, parseSecret, SyncError, type SyncKeys } from './lib/sync'
import { buildPersonSnapshot, buildSnapshot, decryptNote, encryptSnapshot, encryptWithKeyString, generateShareKey, projectsForPerson } from './lib/share'
import { meIdIn } from './lib/balances'
import { computeSplit } from './lib/split'
import { clearSyncMeta, loadSyncMeta, saveSyncMeta } from './lib/syncMeta'
import { categoryOf } from './lib/category'
import { buildBundle, bundleHash, decryptBundle, deriveTripKeys, encryptBundle, generateTripSecret, mergeBundle, tripApi, type TripBundle } from './lib/tripSync'
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
  /** LINE 機器人收件匣（來自 /api/sync，不落地） */
  lineDrafts: import('./lib/line').LineDraft[]
  setLineDrafts: (d: import('./lib/line').LineDraft[]) => void

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
  shareTrip: (id: string) => Promise<string>
  stopSharingTrip: (id: string, deleteRemote: boolean) => Promise<void>
  syncTrip: (id: string, opts?: { quiet?: boolean }) => Promise<void>
  syncTrips: () => Promise<void>
  previewTrip: (id: string, secret: string) => Promise<TripBundle>
  joinTrip: (id: string, secret: string, myPersonId: Id | null, newSelf: boolean) => Promise<string>
  deleteProject: (id: string) => void
  duplicateProject: (id: string) => Project | null
  importData: (data: AppData) => void
  wipe: () => Promise<void>
  showToast: (text: string, emoji?: string) => void

  enableSync: (secret?: string) => Promise<void>
  disableSync: (deleteRemote: boolean) => Promise<void>
  syncNow: (opts?: { quiet?: boolean }) => Promise<void>
  createShare: (projectId: string, days: number, ogTitle?: string | null) => Promise<string>
  createPersonShare: (personId: string, days: number) => Promise<string>
  revokePersonShare: (personId: string) => Promise<void>
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
let tripTimer: ReturnType<typeof setTimeout> | null = null
function markDirty(get: () => State) {
  changeSeq += 1
  const meta = loadSyncMeta()
  saveSyncMeta({ ...meta, dirty: true })
  const s = get()
  // 共編旅程不需要帳號同步也要推
  if ((s.data.trips ?? []).some((t) => t.share)) {
    if (tripTimer) clearTimeout(tripTimer)
    tripTimer = setTimeout(() => get().syncTrips().catch(() => {}), 2500)
  }
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
  lineDrafts: [],
  setLineDrafts: (d) => set({ lineDrafts: d }),

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
    } else get().syncTrips().catch(() => {})
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

  // ---------------- shared trips ----------------

  shareTrip: async (id) => {
    const t = get().data.trips?.find((x) => x.id === id)
    if (!t) throw new Error('旅程不見了')
    if (t.share) return t.share.secret
    const secret = generateTripSecret()
    const keys = await deriveTripKeys(secret)
    const r = await tripApi.create('', keys.token)
    get().updateTrip(id, (tt) => (tt.share = { id: r.id, secret, role: 'owner', version: 0, joinedAt: Date.now(), myPersonId: get().data.me.id }), false)
    await get().syncTrip(id, { quiet: true })
    return secret
  },

  stopSharingTrip: async (id, deleteRemote) => {
    const t = get().data.trips?.find((x) => x.id === id)
    if (!t?.share) return
    if (deleteRemote) {
      const keys = await deriveTripKeys(t.share.secret)
      await tripApi.remove('', keys.token, t.share.id).catch(() => {})
    }
    get().updateTrip(id, (tt) => delete tt.share, false)
  },

  syncTrip: async (id, { quiet = true } = {}) => {
    const s0 = get()
    const t = s0.data.trips?.find((x) => x.id === id)
    if (!t?.share || s0.locked) return
    const share = t.share
    try {
      const keys = await deriveTripKeys(share.secret)
      let remote = await tripApi.get('', keys.token, share.id)
      if (!remote) {
        // 擁有者刪了共編：成員這邊改成本地旅程
        get().updateTrip(id, (tt) => delete tt.share, false)
        if (!quiet) get().showToast('這趟旅程的共編已經被關閉，改為只在本機', '🔒')
        return
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        if (get().locked) return
        let data = get().data
        let changed = false
        let remoteHash: string | null = null
        if (remote.cipher && remote.version !== share.version) {
          let bundle: TripBundle
          try {
            bundle = await decryptBundle(keys.key, remote.cipher)
          } catch {
            throw new Error('旅程金鑰對不上')
          }
          remoteHash = bundleHash(bundle)
          data = mergeBundle(data, id, bundle)
          changed = true
        }
        const mine = buildBundle(data, id)
        if (!mine) return
        const hash = bundleHash(mine)
        const cur = data.trips!.find((x) => x.id === id)!
        if (changed) {
          set({ data })
          scheduleSave(get)
        }
        // 內容跟伺服器一樣就不推（例如剛加入、或別台已推過同樣內容），避免版本號互推
        const needPush = !remote.cipher || (remoteHash != null ? hash !== remoteHash : hash !== (cur.share?.pushedHash ?? ''))
        if (needPush) {
          const r = await tripApi.put('', keys.token, share.id, remote.version, await encryptBundle(keys.key, mine))
          if (!r.ok) {
            remote = { version: r.version, cipher: r.cipher }
            continue
          }
          get().updateTrip(id, (tt) => tt.share && Object.assign(tt.share, { version: r.version, pushedHash: hash }), false)
        } else get().updateTrip(id, (tt) => tt.share && Object.assign(tt.share, { version: remote!.version, pushedHash: hash }), false)
        break
      }
    } catch (e) {
      if (!quiet) get().showToast(e instanceof Error ? e.message : '旅程同步失敗', '😵')
    }
  },

  syncTrips: async () => {
    for (const t of get().data.trips ?? []) if (t.share) await get().syncTrip(t.id, { quiet: true })
  },

  previewTrip: async (id, secret) => {
    const keys = await deriveTripKeys(secret)
    const remote = await tripApi.get('', keys.token, id)
    if (!remote) throw new Error('找不到這趟旅程，連結可能失效了')
    if (!remote.cipher) throw new Error('這趟旅程還沒有內容')
    try {
      return await decryptBundle(keys.key, remote.cipher)
    } catch {
      throw new Error('金鑰對不上，請確認連結完整')
    }
  },

  joinTrip: async (id, secret, myPersonId, newSelf) => {
    const bundle = await get().previewTrip(id, secret)
    const s = get()
    if (s.data.trips?.some((t) => t.id === bundle.trip.id)) {
      // 已經有了（例如是自己另一台裝置）：只補 share
      get().updateTrip(bundle.trip.id, (tt) => (tt.share ??= { id, secret, role: 'member', version: 0, joinedAt: Date.now(), myPersonId: myPersonId ?? s.data.me.id }), false)
    } else {
      let personId = myPersonId
      const me = s.data.me
      get().update((d) => {
        d.trips = [{ ...bundle.trip, share: { id, secret, role: 'member', version: 0, joinedAt: Date.now() } }, ...(d.trips ?? [])]
        for (const p of bundle.projects) if (!d.projects.some((x) => x.id === p.id)) d.projects.push({ ...p, tripId: bundle.trip.id })
        if (newSelf || !personId) {
          // 我不在名單：用自己的 me 加進每本帳
          for (const p of d.projects) if (p.tripId === bundle.trip.id && !p.people.some((x) => x.id === me.id)) p.people.push(me)
          personId = me.id
        }
        const t = d.trips.find((x) => x.id === bundle.trip.id)!
        t.share!.myPersonId = personId
        // 同行的人存成常用朋友
        const seen = new Set(d.friends.map((f) => f.id))
        for (const p of bundle.projects) for (const x of p.people) if (x.id !== personId && x.id !== me.id && !seen.has(x.id)) { seen.add(x.id); d.friends.push(x) }
      })
    }
    await get().syncTrip(bundle.trip.id, { quiet: true })
    return bundle.trip.id
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

        // 3b. 給某人的連結：任何相關帳本更新後重傳快照；伺服器沒有了就拿掉
        for (const [pid, sh] of Object.entries(data.personShares ?? {})) {
          const sv = serverShares.get(`person_${pid}`)
          if (!sv || sv.expiresAt < now) {
            if (data === get().data) data = structuredClone(data)
            delete data.personShares![pid]
            changed = true
            continue
          }
          const projects = projectsForPerson(data.projects, pid, (p) => meIdIn(p, data.me.id, data.trips ?? []), data.baseCurrency, (p) => computeSplit(p, data.baseCurrency).transfers)
          const latest = Math.max(0, ...projects.map((p) => p.updatedAt))
          if (latest > sh.uploadedAt) {
            const person = [data.me, ...data.friends, ...data.projects.flatMap((p) => p.people)].find((x) => x.id === pid)
            if (!person) continue
            const cipher = await encryptWithKeyString(sh.key, buildPersonSnapshot({ person, projects, ownerId: data.me.id, ownerName: data.me.name, baseCurrency: data.baseCurrency, payInfo: data.payInfo }))
            await api.share(base, keys.token, { projectId: `person_${pid}`, cipher, expiresAt: sh.expiresAt, ogTitle: `${person.name} 的帳單 · ${projects.length} 筆` })
            if (data === get().data) data = structuredClone(data)
            data.personShares![pid] = { ...sh, uploadedAt: now }
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
      if (Array.isArray((remote as { lineDrafts?: unknown }).lineDrafts)) set({ lineDrafts: (remote as unknown as { lineDrafts: import('./lib/line').LineDraft[] }).lineDrafts })
      get().syncTrips().catch(() => {})
      // LINE 指令（bot 那邊下的「小明還了」等）：先套用再上傳鏡像
      const cmds = (remote as unknown as { lineCommands?: import('./lib/lineMirror').LineCommandIn[] }).lineCommands
      if (cmds?.length) {
        import('./lib/lineMirror').then(async ({ applyLineCommands }) => {
          const r = { applied: 0, notes: [] as string[] }
          get().update((d) => Object.assign(r, applyLineCommands(d, cmds, newPerson)))
          const { lineApi } = await import('./lib/line')
          await lineApi.ackCommands(cmds.map((c) => c.id))
          if (r.notes.length) get().showToast(`LINE：${r.notes.join('；')}`, '💚')
        }).catch(() => {})
      }
      // LINE 等級 2 鏡像（明文結算結果）
      if (localStorage.getItem('banban:lineMirror') === '1') {
        import('./lib/lineMirror').then(({ buildMirror }) => import('./lib/line').then(({ lineApi }) => lineApi.mirror(buildMirror(get().data)))).catch(() => {})
      }
      // LINE 催款摘要（使用者選擇性開啟；旗標存 localStorage 免得每次多打一次 status）
      if (localStorage.getItem('banban:lineSummary') === '1') {
        import('./lib/balances').then(({ personBalances }) => {
          const d = get().data
          const items = personBalances(d.projects, d.me.id, d.baseCurrency, d.trips ?? [])
            .filter((b) => b.net > 0)
            .map((b) => ({ name: b.person.name, amount: b.net, currency: d.baseCurrency, projects: [...new Set(b.lines.filter((l) => l.signed > 0).map((l) => l.project.name || l.project.emoji))].slice(0, 5) }))
          return import('./lib/line').then(({ lineApi }) => lineApi.summary(items, d.baseCurrency))
        }).catch(() => {})
      }
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

  createPersonShare: async (personId, days) => {
    if (!get().data.sync) await get().enableSync()
    const s = get()
    const d = s.data
    const person = [d.me, ...d.friends, ...d.projects.flatMap((p) => p.people)].find((x) => x.id === personId)
    if (!person) throw new Error('找不到這個人')
    const keys = await keysFor(d.sync!.secret)
    const existing = d.personShares?.[personId]
    const key = existing?.key ?? generateShareKey()
    const projects = projectsForPerson(d.projects, personId, (p) => meIdIn(p, d.me.id, d.trips ?? []), d.baseCurrency, (p) => computeSplit(p, d.baseCurrency).transfers)
    const cipher = await encryptWithKeyString(key, buildPersonSnapshot({ person, projects, ownerId: d.me.id, ownerName: d.me.name, baseCurrency: d.baseCurrency, payInfo: d.payInfo }))
    const expiresAt = Date.now() + days * 86_400_000
    const r = await api.share(apiBase(d.sync!.serverUrl), keys.token, { projectId: `person_${personId}`, cipher, expiresAt, ogTitle: `${person.name} 的帳單 · ${projects.length} 筆` })
    get().update((dd) => (dd.personShares = { ...(dd.personShares ?? {}), [personId]: { id: r.id, key, expiresAt: r.expiresAt, uploadedAt: Date.now(), ogTitle: null } }))
    return r.id
  },

  revokePersonShare: async (personId) => {
    const d = get().data
    const sh = d.personShares?.[personId]
    if (sh && d.sync) {
      const keys = await keysFor(d.sync.secret)
      await api.unshare(apiBase(d.sync.serverUrl), keys.token, sh.id).catch(() => {})
    }
    get().update((dd) => {
      if (dd.personShares) delete dd.personShares[personId]
    })
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
      else if (!s.locked && s.ready) s.syncTrips().catch(() => {})
    }
  })
}

export type { Extra, Item, Person, Project, SplitMode }
