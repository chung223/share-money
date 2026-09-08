/**
 * Friend-facing share links: https://host/s/<id>#<key>
 * The snapshot is encrypted with a random per-project key that only lives in the URL fragment,
 * so the server can store it without being able to read it.
 */
import type { PayInfo, Project } from './types'
import { b64url, decryptWithKey, encryptWithKey, unb64url } from './sync'

export interface ShareSnapshot {
  v: 1
  project: Omit<Project, 'share'>
  baseCurrency: string
  payInfo?: PayInfo
  ownerName: string
  /** The owner's person id inside project.people, so the share page knows which transfers go to them. */
  ownerId?: string
  sharedAt: number
}

/** 給某個人的連結：他在所有帳本裡跟我的往來（未結清的 + 最近結清的），一條連結看完、逐筆按「我轉了」。 */
export interface PersonSnapshot {
  v: 2
  kind: 'person'
  personId: string
  person: { id: string; name: string; emoji: string; color: string }
  ownerId: string
  ownerName: string
  baseCurrency: string
  payInfo?: PayInfo
  projects: Omit<Project, 'share'>[]
  sharedAt: number
}
export type AnySnapshot = ShareSnapshot | PersonSnapshot
export function isPersonSnapshot(s: AnySnapshot): s is PersonSnapshot {
  return (s as PersonSnapshot).v === 2 && (s as PersonSnapshot).kind === 'person'
}

/** 挑出這個人有參與、且跟我之間有轉帳（未結清，或 60 天內結清）的帳本 */
export function projectsForPerson(projects: Project[], personId: string, meIds: (p: Project) => string | null, _base: string, computeTransfers: (p: Project) => { from: string; to: string; settled: boolean }[]): Project[] {
  const cutoff = Date.now() - 60 * 86_400_000
  return projects
    .filter((p) => {
      const me = meIds(p)
      if (!me || !p.people.some((x) => x.id === personId)) return false
      const ts = computeTransfers(p).filter((t) => (t.from === personId && t.to === me) || (t.from === me && t.to === personId))
      return ts.some((t) => !t.settled) || (ts.length > 0 && p.updatedAt > cutoff)
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)
}

export function buildPersonSnapshot(o: { person: PersonSnapshot['person']; projects: Project[]; ownerId: string; ownerName: string; baseCurrency: string; payInfo?: PayInfo }): PersonSnapshot {
  return {
    v: 2,
    kind: 'person',
    personId: o.person.id,
    person: o.person,
    ownerId: o.ownerId,
    ownerName: o.ownerName,
    baseCurrency: o.baseCurrency,
    payInfo: o.payInfo,
    projects: o.projects.map((p) => {
      const { share: _s, ...rest } = p
      return rest
    }),
    sharedAt: Date.now(),
  }
}
export async function decryptAnySnapshot(key: string, cipher: string) {
  return decryptWithKey<AnySnapshot>(await importKey(key), cipher)
}

export function generateShareKey() {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return b64url(b)
}

async function importKey(key: string) {
  return crypto.subtle.importKey('raw', unb64url(key) as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptWithKeyString(key: string, value: unknown) {
  return encryptWithKey(await importKey(key), value)
}
export async function encryptSnapshot(key: string, snap: ShareSnapshot) {
  return encryptWithKey(await importKey(key), snap)
}
export async function decryptSnapshot(key: string, cipher: string) {
  return decryptWithKey<ShareSnapshot>(await importKey(key), cipher)
}

/** Friend-side: the note travels encrypted with the share key, so only the owner can read it. */
export async function encryptNote(key: string, note: string) {
  return encryptWithKey(await importKey(key), { note })
}
export async function decryptNote(key: string, cipher: string): Promise<string | null> {
  try {
    const v = await decryptWithKey<{ note?: string }>(await importKey(key), cipher)
    return typeof v.note === 'string' ? v.note.slice(0, 200) : null
  } catch {
    return null
  }
}

export function buildSnapshot(project: Project, baseCurrency: string, ownerName: string, payInfo?: PayInfo, ownerId?: string): ShareSnapshot {
  const { share: _share, ...rest } = project
  return { v: 1, project: rest, baseCurrency, payInfo, ownerName, ownerId, sharedAt: Date.now() }
}

export function shareUrl(id: string, key: string, origin = location.origin) {
  return `${origin}/s/${id}#${key}`
}

export function parseShareLocation(loc: { pathname: string; hash: string }) {
  const m = /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(loc.pathname)
  const key = loc.hash.replace(/^#/, '')
  if (!m || !/^[A-Za-z0-9_-]{20,24}$/.test(key)) return null
  return { id: m[1], key }
}

export const SHARE_DURATIONS: { days: number; label: string }[] = [
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
  { days: 90, label: '90 天' },
]

/** Default preview title: category emoji + name + headcount. No amounts, ever. */
export function defaultOgTitle(p: Project, unnamed: string) {
  return `${p.emoji} ${p.name || unnamed} · ${p.people.length} 人`
}
