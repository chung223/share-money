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
  sharedAt: number
}

export function generateShareKey() {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return b64url(b)
}

async function importKey(key: string) {
  return crypto.subtle.importKey('raw', unb64url(key) as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptSnapshot(key: string, snap: ShareSnapshot) {
  return encryptWithKey(await importKey(key), snap)
}
export async function decryptSnapshot(key: string, cipher: string) {
  return decryptWithKey<ShareSnapshot>(await importKey(key), cipher)
}

export function buildSnapshot(project: Project, baseCurrency: string, ownerName: string, payInfo?: PayInfo): ShareSnapshot {
  const { share: _share, ...rest } = project
  return { v: 1, project: rest, baseCurrency, payInfo, ownerName, sharedAt: Date.now() }
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
