/**
 * Multi-device sync, end-to-end encrypted.
 *
 * One random 32-byte secret (shown as `bb1.<base64url>`, transferred by QR) is the whole identity:
 *   HKDF(secret, 'auth') -> bearer token the server hashes and stores
 *   HKDF(secret, 'enc')  -> AES-GCM key that never leaves the device
 * The server only ever sees ciphertext + a version number.
 */
import type { AppData, Id, Project } from './types'

const enc = new TextEncoder()
const dec = new TextDecoder()

export const SECRET_PREFIX = 'bb1.'

export function b64url(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function unb64url(s: string) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b.length % 4 ? '='.repeat(4 - (b.length % 4)) : ''
  return Uint8Array.from(atob(b + pad), (c) => c.charCodeAt(0))
}

export function generateSecret() {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return SECRET_PREFIX + b64url(b)
}

/** Accepts the raw secret, or a full URL / text containing it (QR payloads). */
export function parseSecret(text: string): string | null {
  const m = /bb1\.([A-Za-z0-9_-]{43})/.exec(text.trim())
  if (!m) return null
  try {
    if (unb64url(m[1]).length !== 32) return null
  } catch {
    return null
  }
  return SECRET_PREFIX + m[1]
}

export interface SyncKeys {
  token: string
  key: CryptoKey
}

export async function deriveSyncKeys(secret: string): Promise<SyncKeys> {
  const parsed = parseSecret(secret)
  if (!parsed) throw new Error('bad-secret')
  const ikm = await crypto.subtle.importKey('raw', unb64url(parsed.slice(SECRET_PREFIX.length)) as BufferSource, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const salt = enc.encode('banban-sync-v1')
  const tokenBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('auth') }, ikm, 256)
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('enc') }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return { token: b64url(tokenBits), key }
}

export interface Cipher {
  v: 1
  iv: string
  data: string
}

export async function encryptWithKey(key: CryptoKey, value: unknown): Promise<string> {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(JSON.stringify(value)))
  const c: Cipher = { v: 1, iv: b64url(iv), data: b64url(data) }
  return JSON.stringify(c)
}

export async function decryptWithKey<T>(key: CryptoKey, cipher: string): Promise<T> {
  const c = JSON.parse(cipher) as Cipher
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(c.iv) as BufferSource }, key, unb64url(c.data) as BufferSource)
  return JSON.parse(dec.decode(plain)) as T
}

// ---------- API client ----------

export interface ShareEvent {
  id: number
  shareId: string
  projectId: Id
  personId: Id
  kind: 'paid' | 'unpaid'
  createdAt: number
}
export interface RemoteState {
  version: number
  cipher: string | null
  updatedAt: number | null
  events: ShareEvent[]
  shares: { id: string; projectId: Id; expiresAt: number; updatedAt: number }[]
}

export class SyncError extends Error {
  constructor(
    public code: 'network' | 'unauthorized' | 'server' | 'decrypt',
    message: string,
  ) {
    super(message)
  }
}

export function apiBase(serverUrl: string) {
  return (serverUrl || '').replace(/\/+$/, '')
}

async function req(base: string, path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (init.token) headers.authorization = `Bearer ${init.token}`
  if (init.json !== undefined) headers['content-type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(base + path, { method: init.method ?? 'GET', headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined, cache: 'no-store' })
  } catch (e) {
    throw new SyncError('network', e instanceof Error ? e.message : 'network')
  }
  if (res.status === 401) throw new SyncError('unauthorized', 'unauthorized')
  return res
}

export const api = {
  async get(base: string, token: string): Promise<RemoteState> {
    const r = await req(base, '/api/sync', { token })
    if (!r.ok) throw new SyncError('server', `HTTP ${r.status}`)
    return r.json()
  },
  /** Returns the new version, or the server copy on conflict. */
  async put(base: string, token: string, baseVersion: number, cipher: string): Promise<{ ok: true; version: number } | { ok: false; version: number; cipher: string | null }> {
    const r = await req(base, '/api/sync', { method: 'PUT', token, json: { baseVersion, cipher } })
    if (r.status === 409) {
      const j = await r.json()
      return { ok: false, version: j.version, cipher: j.cipher }
    }
    if (!r.ok) throw new SyncError('server', `HTTP ${r.status}`)
    return { ok: true, version: (await r.json()).version }
  },
  async remove(base: string, token: string) {
    const r = await req(base, '/api/sync', { method: 'DELETE', token })
    if (!r.ok) throw new SyncError('server', `HTTP ${r.status}`)
  },
  async ack(base: string, token: string, ids: number[]) {
    if (!ids.length) return
    await req(base, '/api/share/ack', { method: 'POST', token, json: { ids } })
  },
  async share(base: string, token: string, body: { projectId: Id; cipher: string; expiresAt: number }): Promise<{ id: string; expiresAt: number }> {
    const r = await req(base, '/api/share', { method: 'POST', token, json: body })
    if (!r.ok) throw new SyncError('server', `HTTP ${r.status}`)
    return r.json()
  },
  async unshare(base: string, token: string, id: string) {
    await req(base, `/api/share/${id}`, { method: 'DELETE', token })
  },
}

// ---------- merge ----------

const TOMBSTONE_TTL = 90 * 86_400_000

/**
 * Three-way-ish merge without a base: projects are last-writer-wins by updatedAt,
 * deletions win via tombstones, friends are unioned, scalar fields follow the newer blob.
 * Pure and deterministic so it can be unit-tested.
 */
export function mergeData(local: AppData, remote: AppData, now = Date.now()): AppData {
  const localNewer = (local.updatedAt ?? 0) >= (remote.updatedAt ?? 0)
  const newer = localNewer ? local : remote
  const older = localNewer ? remote : local

  const deleted: Record<Id, number> = {}
  for (const src of [local.deleted ?? {}, remote.deleted ?? {}]) {
    for (const [id, ts] of Object.entries(src)) if (now - ts < TOMBSTONE_TTL) deleted[id] = Math.max(deleted[id] ?? 0, ts)
  }

  const byId = new Map<Id, Project>()
  for (const p of [...remote.projects, ...local.projects]) {
    const cur = byId.get(p.id)
    if (!cur || (p.updatedAt ?? 0) > (cur.updatedAt ?? 0)) byId.set(p.id, p)
    else if (cur && (p.updatedAt ?? 0) === (cur.updatedAt ?? 0) && local.projects.includes(p)) byId.set(p.id, p) // tie -> local
  }
  for (const [id, ts] of Object.entries(deleted)) {
    const p = byId.get(id)
    if (p && ts >= (p.updatedAt ?? 0)) byId.delete(id)
    else if (p) delete deleted[id] // edited after deletion elsewhere: the edit wins, drop the tombstone
  }
  const projects = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)

  const friends = [...newer.friends]
  for (const f of older.friends) if (!friends.some((x) => x.id === f.id)) friends.push(f)

  return {
    ...older,
    ...newer,
    projects,
    friends,
    deleted,
    payInfo: newer.payInfo ?? older.payInfo,
    sync: local.sync ?? remote.sync,
    updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0),
  }
}

/** Applies "I paid" events from share pages onto project.settled. Returns the ids consumed. */
export function applyShareEvents(data: AppData, events: ShareEvent[]): number[] {
  const consumed: number[] = []
  for (const e of events) {
    consumed.push(e.id)
    const p = data.projects.find((x) => x.id === e.projectId)
    if (!p) continue
    if (!p.people.some((x) => x.id === e.personId)) continue
    p.settled[e.personId] = e.kind === 'paid'
    p.updatedAt = Math.max(p.updatedAt, e.createdAt)
  }
  return consumed
}

/** Deterministic JSON (sorted keys) so two devices can tell "same content" apart from "same object". */
export function canon(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o: Record<string, unknown> = {}
      for (const k of Object.keys(v).sort()) o[k] = (v as Record<string, unknown>)[k]
      return o
    }
    return v
  })
}

/** Strips things that must not round-trip through another device (nothing yet, but keep the seam). */
export function forUpload(data: AppData): AppData {
  return data
}
