import { create } from 'zustand'
import type { AppData, Extra, Item, Person, Project, SplitMode } from './lib/types'
import { PALETTE, PERSON_EMOJIS } from './lib/types'
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

interface State {
  ready: boolean
  locked: boolean
  encrypted: boolean
  prefs: LocalPrefs
  data: AppData
  session: Session
  toast: { id: number; text: string; emoji?: string } | null

  init: () => Promise<void>
  unlock: (pin: string) => Promise<boolean>
  lock: () => void
  setPin: (pin: string) => Promise<void>
  removePin: () => Promise<void>
  setPrefs: (p: Partial<LocalPrefs>) => void
  update: (fn: (d: AppData) => void) => void
  updateProject: (id: string, fn: (p: Project) => void) => void
  addProject: () => Project
  deleteProject: (id: string) => void
  duplicateProject: (id: string) => Project | null
  importData: (data: AppData) => void
  wipe: () => Promise<void>
  showToast: (text: string, emoji?: string) => void
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

export const useStore = create<State>((set, get) => ({
  ready: false,
  locked: false,
  encrypted: false,
  prefs: loadPrefs(),
  data: defaultData(),
  session: { key: null, salt: null },
  toast: null,

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
  },

  unlock: async (pin) => {
    try {
      const { data, session } = await unlockWithPin(pin)
      set({ data: { ...defaultData(), ...data }, session, locked: false })
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
    set({ data })
    scheduleSave(get)
  },

  updateProject: (id, fn) => {
    get().update((d) => {
      const p = d.projects.find((x) => x.id === id)
      if (!p) return
      fn(p)
      p.updatedAt = Date.now()
    })
  },

  addProject: () => {
    const { data } = get()
    const p = newProject(data.me, data.baseCurrency)
    get().update((d) => d.projects.unshift(p))
    return p
  },

  deleteProject: (id) => get().update((d) => (d.projects = d.projects.filter((p) => p.id !== id))),

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
    set({ data: defaultData(), session: { key: null, salt: null }, encrypted: false, locked: false, prefs: loadPrefs() })
  },

  showToast: (text, emoji) => {
    const id = Date.now()
    set({ toast: { id, text, emoji } })
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, 2200)
  },
}))

export type { Extra, Item, Person, Project, SplitMode }
