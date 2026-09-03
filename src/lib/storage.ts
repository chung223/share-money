import { get, set, del } from 'idb-keyval'
import type { AppData } from './types'
import { decryptJson, deriveKey, encryptJson, randomBytes, saltFromBlob, type EncryptedBlob } from './crypto'

const KEY = 'banban:data'

interface PlainBlob {
  enc: false
  v: 1
  data: AppData
}
type StoredBlob = PlainBlob | EncryptedBlob

export type LockDelay = 0 | 60 | 300 | 900 // seconds hidden before auto-lock

export interface LocalPrefs {
  theme: 'light' | 'dark' | 'system'
  hasPin: boolean
  lockDelay: LockDelay
}

const PREFS_KEY = 'banban:prefs'
export function loadPrefs(): LocalPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) return { theme: 'system', hasPin: false, lockDelay: 0, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { theme: 'system', hasPin: false, lockDelay: 0 }
}
export function savePrefs(p: LocalPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  localStorage.setItem('banban:theme', p.theme)
}

export async function readBlob(): Promise<StoredBlob | undefined> {
  return get<StoredBlob>(KEY)
}

export async function isEncrypted() {
  const blob = await readBlob()
  return !!blob && blob.enc === true
}

export async function loadPlain(): Promise<AppData | null> {
  const blob = await readBlob()
  if (!blob) return null
  if (blob.enc) throw new Error('encrypted')
  return blob.data
}

export interface Session {
  key: CryptoKey | null
  salt: Uint8Array | null
}

export async function unlockWithPin(pin: string): Promise<{ data: AppData; session: Session }> {
  const blob = await readBlob()
  if (!blob || !blob.enc) throw new Error('not-encrypted')
  const salt = saltFromBlob(blob)
  const key = await deriveKey(pin, salt, blob.iter)
  const data = await decryptJson<AppData>(key, blob) // throws on wrong PIN
  return { data, session: { key, salt } }
}

export async function persist(data: AppData, session: Session) {
  if (session.key && session.salt) {
    const blob = await encryptJson(session.key, session.salt, data)
    await set(KEY, blob)
  } else {
    const blob: PlainBlob = { enc: false, v: 1, data }
    await set(KEY, blob)
  }
}

export async function createPinSession(pin: string): Promise<Session> {
  const salt = randomBytes(16)
  const key = await deriveKey(pin, salt)
  return { key, salt }
}

export async function wipeAll() {
  await del(KEY)
  localStorage.removeItem(PREFS_KEY)
  localStorage.removeItem('banban:theme')
}
