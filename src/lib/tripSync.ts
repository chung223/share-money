/**
 * 共編旅程：一趟旅程一把 secret（在連結的 # 後面），派生 auth token（伺服器只存 hash）與 AES 金鑰。
 * 上傳的 bundle = { trip 資料, 這趟的帳本, 墓碑 }，用 mergeData 的同一套規則合併。
 */
import type { AppData, Id, Project, Trip } from './types'
import { b64url, canon, decryptWithKey, encryptWithKey, mergeData, unb64url } from './sync'

const enc = new TextEncoder()
export const TRIP_PREFIX = 'bt1.'

export function generateTripSecret() {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return TRIP_PREFIX + b64url(b)
}
export function parseTripSecret(text: string): string | null {
  const m = /bt1\.([A-Za-z0-9_-]{43})/.exec(text)
  if (!m) return null
  try {
    if (unb64url(m[1]).length !== 32) return null
  } catch {
    return null
  }
  return TRIP_PREFIX + m[1]
}
export async function deriveTripKeys(secret: string): Promise<{ token: string; key: CryptoKey }> {
  const parsed = parseTripSecret(secret)
  if (!parsed) throw new Error('bad-trip-secret')
  const ikm = await crypto.subtle.importKey('raw', unb64url(parsed.slice(TRIP_PREFIX.length)) as BufferSource, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const salt = enc.encode('banban-trip-v1')
  const tokenBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('auth') }, ikm, 256)
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('enc') }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return { token: b64url(tokenBits), key }
}

export interface TripBundle {
  v: 1
  trip: Omit<Trip, 'share'>
  projects: Project[]
  /** 這趟裡被刪掉的帳本 */
  deleted: Record<Id, number>
  updatedAt: number
}

export function buildBundle(data: AppData, tripId: Id): TripBundle | null {
  const t = data.trips?.find((x) => x.id === tripId)
  if (!t) return null
  const { share: _s, ...trip } = t
  const projects = data.projects.filter((p) => p.tripId === tripId).map((p) => {
    const { share: _ps, ...rest } = p // 個人的分享連結不跟著共編走
    return rest as Project
  })
  const deleted: Record<Id, number> = {}
  for (const [k, ts] of Object.entries(data.deleted ?? {})) if (!k.startsWith('trip:') && !data.projects.some((p) => p.id === k)) deleted[k] = ts
  return { v: 1, trip, projects, deleted, updatedAt: Math.max(t.updatedAt, ...projects.map((p) => p.updatedAt)) }
}

/** 內容指紋：用來判斷「本地有沒有改」而不必記 dirty 旗標。 */
export function bundleHash(b: TripBundle) {
  return canon({ trip: b.trip, projects: b.projects, deleted: b.deleted })
}

export async function encryptBundle(key: CryptoKey, b: TripBundle) {
  return encryptWithKey(key, b)
}
export async function decryptBundle(key: CryptoKey, cipher: string) {
  return decryptWithKey<TripBundle>(key, cipher)
}

/**
 * 把遠端 bundle 併進本地資料：這趟的帳本走 mergeData 的 LWW + 墓碑，旅程本身以 updatedAt 新者為準；
 * 不在這趟的帳本、朋友、設定完全不動。回傳新的 AppData（不改原物件）。
 */
export function mergeBundle(data: AppData, tripId: Id, remote: TripBundle, now = Date.now()): AppData {
  const localTrip = data.trips?.find((t) => t.id === tripId)
  const localProjects = data.projects.filter((p) => p.tripId === tripId)
  const localDeleted: Record<Id, number> = {}
  for (const [k, ts] of Object.entries(data.deleted ?? {})) if (!k.startsWith('trip:')) localDeleted[k] = ts
  const fakeLocal: AppData = { ...data, projects: localProjects, deleted: localDeleted, trips: undefined, updatedAt: localTrip?.updatedAt ?? 0 }
  const fakeRemote: AppData = { ...data, projects: remote.projects.map((p) => ({ ...p, tripId })), deleted: remote.deleted, trips: undefined, updatedAt: remote.trip.updatedAt }
  const merged = mergeData(fakeLocal, fakeRemote, now)
  const others = data.projects.filter((p) => p.tripId !== tripId)
  const tripMeta = !localTrip || remote.trip.updatedAt > localTrip.updatedAt ? { ...localTrip, ...remote.trip, share: localTrip?.share } : localTrip
  const trips = (data.trips ?? []).map((t) => (t.id === tripId ? (tripMeta as Trip) : t))
  if (!localTrip) trips.push(tripMeta as Trip)
  // 墓碑合併回總表；遠端墓碑只對「這趟的帳本」有效，不能誤殺本地其他帳本
  const deleted = { ...(data.deleted ?? {}), ...merged.deleted }
  for (const p of others) delete deleted[p.id]
  return { ...data, projects: [...others, ...merged.projects].sort((a, b) => b.createdAt - a.createdAt), trips, deleted }
}

export function tripJoinUrl(id: string, secret: string, origin = location.origin) {
  return `${origin}/#/join/${id}/${secret}`
}

// ---- API ----
export const tripApi = {
  async create(base: string, token: string): Promise<{ id: string }> {
    const r = await fetch(`${base}/api/trip`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },
  async get(base: string, token: string, id: string): Promise<{ version: number; cipher: string | null } | null> {
    const r = await fetch(`${base}/api/trip/${id}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },
  async put(base: string, token: string, id: string, baseVersion: number, cipher: string): Promise<{ ok: true; version: number } | { ok: false; version: number; cipher: string | null }> {
    const r = await fetch(`${base}/api/trip/${id}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ baseVersion, cipher }) })
    if (r.status === 409) {
      const j = await r.json()
      return { ok: false, version: j.version, cipher: j.cipher }
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return { ok: true, version: (await r.json()).version }
  },
  async remove(base: string, token: string, id: string) {
    await fetch(`${base}/api/trip/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
  },
}
