/** AI 收據辨識（伺服器代呼叫 MiniMax）。需要開同步（用帳號算額度），且帳號要有權限（邀請碼或管理者開通）。 */
import { useStore } from '../store'
import { api, apiBase, deriveSyncKeys, SyncError } from './sync'

export interface AiParsed {
  items: { name: string; qty: number; price: number }[]
  extras: { name: string; amount: number }[]
  total: number | null
  date: string | null
  currency: string | null
  merchant: string | null
  remaining: number
}
export interface AiStatus {
  available: boolean
  allowed: boolean
  needsCode: boolean
  used: number
  quota: number
  remaining: number
  accountId: string
}

let statusCache: { at: number; value: AiStatus } | null = null
export function invalidateAiStatus() {
  statusCache = null
}

async function authed() {
  const cfg = useStore.getState().data.sync
  if (!cfg) return null
  const keys = await deriveSyncKeys(cfg.secret)
  return { base: apiBase(cfg.serverUrl), token: keys.token }
}

/** 沒開同步 → null（不知道）；有開 → 伺服器回的狀態（快取 60 秒）。 */
export async function aiStatus(force = false): Promise<AiStatus | null> {
  const a = await authed()
  if (!a) return null
  if (!force && statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value
  try {
    const r = await api.raw(a.base, '/api/ai/status', { token: a.token })
    if (!r.ok) return null
    const value = (await r.json()) as AiStatus
    statusCache = { at: Date.now(), value }
    return value
  } catch {
    return null
  }
}

/** 匯入面板用：這台現在能不能用 AI。 */
export async function aiAvailable(): Promise<boolean> {
  const s = await aiStatus()
  return !!s?.allowed && s.remaining > 0
}

export async function redeemAiCode(code: string): Promise<AiStatus> {
  const s = useStore.getState()
  if (!s.data.sync) await s.enableSync()
  const a = (await authed())!
  const r = await api.raw(a.base, '/api/ai/redeem', { method: 'POST', token: a.token, json: { code } })
  if (r.status === 403) throw new Error('邀請碼不對')
  if (r.status === 429) throw new Error('試太多次了，等一小時')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const value = (await r.json()) as AiStatus
  statusCache = { at: Date.now(), value }
  return value
}

export async function aiParse(input: { text?: string; image?: { mediaType: string; base64: string } }): Promise<AiParsed> {
  const s = useStore.getState()
  if (!s.data.sync) await s.enableSync()
  const a = (await authed())!
  const r = await api.raw(a.base, '/api/parse', { method: 'POST', token: a.token, json: input })
  if (r.status === 403) throw new Error('這個帳號還沒開通 AI，到設定頁輸入邀請碼')
  if (r.status === 429) throw new Error('今天的 AI 額度用完了，明天再來或先用一般辨識')
  if (r.status === 404) throw new Error('伺服器沒開 AI 辨識')
  if (!r.ok) throw new SyncError('server', `AI 辨識失敗（HTTP ${r.status}）`)
  invalidateAiStatus()
  return r.json()
}

/** canvas → JPEG base64（不含 data: 前綴），給 AI 用 */
export function canvasToJpegBase64(c: HTMLCanvasElement, quality = 0.85) {
  return c.toDataURL('image/jpeg', quality).split(',')[1]
}
