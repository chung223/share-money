/**
 * PWA 更新：SW 用 prompt 模式（不會在你打字到一半時自己重載）。
 * - 有新版時 needRefresh = true，App 顯示提示條；按下去 applyUpdate()。
 * - 設定頁「檢查更新」：抓 /version.json（4 秒逾時）比對版本 → 叫 SW 更新 → 8 秒內沒換成功就硬重載。
 */
import { create } from 'zustand'
import { registerSW } from 'virtual:pwa-register'

declare const __APP_VERSION__: string
export const APP_VERSION = __APP_VERSION__

interface UpdateState {
  needRefresh: boolean
  checking: boolean
  latest: string | null
  offlineReady: boolean
}
export const useUpdate = create<UpdateState>(() => ({ needRefresh: false, checking: false, latest: null, offlineReady: false }))

let registration: ServiceWorkerRegistration | undefined
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => useUpdate.setState({ needRefresh: true }),
  onOfflineReady: () => useUpdate.setState({ offlineReady: true }),
  onRegisteredSW: (_url, reg) => {
    registration = reg
    // 每 30 分鐘在背景看一次有沒有新版
    if (reg) setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000)
  },
})

/** 硬重載：解除 SW、清 cache、加參數重新載入。 */
export async function hardReload() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations()
    await Promise.all((regs ?? []).map((r) => r.unregister()))
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)))
  } catch {
    /* ignore */
  }
  const u = new URL(location.href)
  u.searchParams.set('v', String(Date.now()))
  location.replace(u.toString())
}

/** 套用已經下載好的新版（SW skipWaiting + reload）。卡住 8 秒就硬重載。 */
export function applyUpdate() {
  const t = setTimeout(hardReload, 8000)
  updateSW(true)
    .catch(() => {})
    .finally(() => {
      // updateSW(true) 正常會 reload 頁面；到這裡代表沒 reload，交給計時器
      void t
    })
}

async function fetchLatestVersion(): Promise<string | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 4000)
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store', signal: ctl.signal })
    if (!r.ok) return null
    const j = (await r.json()) as { version?: string }
    return j.version ?? null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

export type CheckResult = 'latest' | 'updating' | 'offline'

/** 設定頁按鈕用。回傳 'updating' 時頁面很快會重載。 */
export async function checkForUpdate(): Promise<CheckResult> {
  useUpdate.setState({ checking: true })
  try {
    const latest = await fetchLatestVersion()
    useUpdate.setState({ latest })
    if (!latest) return 'offline'
    if (latest === APP_VERSION && !useUpdate.getState().needRefresh) return 'latest'
    // 有新版：先請 SW 去抓；抓到會觸發 onNeedRefresh
    if (useUpdate.getState().needRefresh) {
      applyUpdate()
      return 'updating'
    }
    const hard = setTimeout(hardReload, 8000)
    try {
      await registration?.update()
    } catch {
      /* ignore */
    }
    const ok = await new Promise<boolean>((resolve) => {
      if (useUpdate.getState().needRefresh) return resolve(true)
      const unsub = useUpdate.subscribe((s) => {
        if (s.needRefresh) {
          unsub()
          resolve(true)
        }
      })
      setTimeout(() => {
        unsub()
        resolve(false)
      }, 6000)
    })
    clearTimeout(hard)
    if (ok) applyUpdate()
    else hardReload()
    return 'updating'
  } finally {
    useUpdate.setState({ checking: false })
  }
}
