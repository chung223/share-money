/** AI 收據辨識（伺服器代呼叫 Claude）。需要開同步（用帳號算每日額度）。 */
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

let available: Promise<boolean> | null = null
export function aiAvailable(): Promise<boolean> {
  if (!available) {
    available = fetch('/api/health', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => !!j.ai)
      .catch(() => false)
  }
  return available
}

export async function aiParse(input: { text?: string; image?: { mediaType: string; base64: string } }): Promise<AiParsed> {
  const s = useStore.getState()
  if (!s.data.sync) await s.enableSync()
  const cfg = useStore.getState().data.sync!
  const keys = await deriveSyncKeys(cfg.secret)
  const r = await api.raw(apiBase(cfg.serverUrl), '/api/parse', { method: 'POST', token: keys.token, json: input })
  if (r.status === 429) throw new Error('今天的 AI 額度用完了，明天再來或先用一般辨識')
  if (r.status === 404) throw new Error('伺服器沒開 AI 辨識')
  if (!r.ok) throw new SyncError('server', `AI 辨識失敗（HTTP ${r.status}）`)
  return r.json()
}

/** canvas → JPEG base64（不含 data: 前綴），給 AI 用 */
export function canvasToJpegBase64(c: HTMLCanvasElement, quality = 0.85) {
  return c.toDataURL('image/jpeg', quality).split(',')[1]
}
