/** Per-device sync bookkeeping (not part of the encrypted data). */
export interface SyncMeta {
  version: number
  lastSyncAt: number | null
  dirty: boolean
}
const KEY = 'banban:syncmeta'
export function loadSyncMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { version: 0, lastSyncAt: null, dirty: false, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { version: 0, lastSyncAt: null, dirty: false }
}
export function saveSyncMeta(m: SyncMeta) {
  localStorage.setItem(KEY, JSON.stringify(m))
}
export function clearSyncMeta() {
  localStorage.removeItem(KEY)
}
