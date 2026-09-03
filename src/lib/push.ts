/** Web Push 訂閱（需要已開啟同步，才有身分可綁）。iOS 要加入主畫面後從主畫面開才支援。 */
import { api, apiBase, deriveSyncKeys, unb64url } from './sync'
import type { SyncConfig } from './types'

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}
export function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}
export function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

export async function pushStatus(): Promise<'unsupported' | 'denied' | 'on' | 'off'> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return (await currentSubscription()) ? 'on' : 'off'
}

export async function enablePush(cfg: SyncConfig) {
  if (!pushSupported()) throw new Error('這個瀏覽器不支援推播')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('沒有允許通知')
  const base = apiBase(cfg.serverUrl)
  const key = await api.vapidKey(base)
  if (!key) throw new Error('伺服器沒開推播')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64url(key) as BufferSource })
  const keys = await deriveSyncKeys(cfg.secret)
  await api.pushSubscribe(base, keys.token, sub.toJSON())
}

export async function disablePush(cfg: SyncConfig | undefined) {
  const sub = await currentSubscription()
  if (!sub) return
  if (cfg) {
    const keys = await deriveSyncKeys(cfg.secret)
    await api.pushUnsubscribe(apiBase(cfg.serverUrl), keys.token, sub.endpoint).catch(() => {})
  }
  await sub.unsubscribe()
}

export async function testPush(cfg: SyncConfig) {
  const keys = await deriveSyncKeys(cfg.secret)
  await api.pushTest(apiBase(cfg.serverUrl), keys.token)
}
