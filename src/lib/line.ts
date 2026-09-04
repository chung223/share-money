/** LINE 機器人（設定頁連結、收件匣）。需要開同步（帳號才有地方綁）。 */
import { useStore } from '../store'
import { api, apiBase, deriveSyncKeys } from './sync'

export interface LineStatus {
  available: boolean
  linked: boolean
  displayName: string | null
  pushEnabled: boolean
  pushMode: 'off' | 'fallback' | 'always'
  summaryEnabled: boolean
  weeklyEnabled: boolean
  mirrorEnabled: boolean
  pending: number
}
export interface LineDraft {
  id: number
  kind: 'text' | 'receipt' | 'image'
  payload: { text?: string; receipt?: { items: { name: string; qty: number; price: number }[]; extras?: { name: string; amount: number }[]; total: number | null; date: string | null; currency: string | null; merchant: string | null }; image?: { mediaType: string; base64: string } }
  createdAt: number
}

async function authed() {
  const s = useStore.getState()
  if (!s.data.sync) await s.enableSync()
  const cfg = useStore.getState().data.sync!
  const keys = await deriveSyncKeys(cfg.secret)
  return { base: apiBase(cfg.serverUrl), token: keys.token }
}
const j = async (r: Response) => {
  if (r.status === 404) throw new Error('伺服器沒開 LINE 機器人')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}
export const lineApi = {
  async status(): Promise<LineStatus | null> {
    const cfg = useStore.getState().data.sync
    if (!cfg) return null
    const a = await authed()
    const r = await api.raw(a.base, '/api/line/status', { token: a.token })
    return r.ok ? r.json() : null
  },
  async linkCode(): Promise<{ code: string; expiresIn: number }> {
    const a = await authed()
    return j(await api.raw(a.base, '/api/line/link-code', { method: 'POST', token: a.token, json: {} }))
  },
  async unlink() {
    const a = await authed()
    await api.raw(a.base, '/api/line/link', { method: 'DELETE', token: a.token })
  },
  async setPush(enabled: boolean) {
    const a = await authed()
    await api.raw(a.base, '/api/line/push', { method: 'POST', token: a.token, json: { enabled } })
  },
  async settings(patch: { pushEnabled?: boolean; pushMode?: 'off' | 'fallback' | 'always'; summaryEnabled?: boolean; weeklyEnabled?: boolean; mirrorEnabled?: boolean }) {
    const a = await authed()
    await j(await api.raw(a.base, '/api/line/settings', { method: 'POST', token: a.token, json: patch }))
  },
  /** 上傳「誰欠我」明文摘要（使用者開了 summaryEnabled 才會被接受） */
  async summary(items: { name: string; amount: number; currency: string; projects: string[] }[], currency: string) {
    const a = await authed()
    const r = await api.raw(a.base, '/api/line/summary', { method: 'POST', token: a.token, json: { items, currency } })
    return r.ok
  },
  async mirror(payload: unknown) {
    const a = await authed()
    const r = await api.raw(a.base, '/api/line/mirror', { method: 'POST', token: a.token, json: payload })
    return r.ok
  },
  async ackCommands(ids: number[]) {
    if (!ids.length) return
    const a = await authed()
    await api.raw(a.base, '/api/line/ack-commands', { method: 'POST', token: a.token, json: { ids } })
  },
  async meme(o: { name: string; amountText: string; mood: 'cute' | 'angry' | 'sad' | 'party'; line?: string }): Promise<{ id: string; url: string }> {
    const a = await authed()
    const r = await api.raw(a.base, '/api/meme', { method: 'POST', token: a.token, json: o })
    if (r.status === 429) throw new Error('今天的 AI 額度不夠（生一張圖算 3 次）')
    if (r.status === 403) throw new Error('這個帳號還沒開通 AI')
    if (r.status === 404) throw new Error('伺服器沒開生圖')
    if (!r.ok) throw new Error(`生圖失敗（HTTP ${r.status}）`)
    return r.json()
  },
  async ack(ids: number[]) {
    if (!ids.length) return
    const a = await authed()
    await api.raw(a.base, '/api/line/ack', { method: 'POST', token: a.token, json: { ids } })
  },
}
