/** LINE 機器人（設定頁連結、收件匣）。需要開同步（帳號才有地方綁）。 */
import { useStore } from '../store'
import { api, apiBase, deriveSyncKeys } from './sync'

export interface LineStatus {
  available: boolean
  linked: boolean
  displayName: string | null
  pushEnabled: boolean
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
  async ack(ids: number[]) {
    if (!ids.length) return
    const a = await authed()
    await api.raw(a.base, '/api/line/ack', { method: 'POST', token: a.token, json: { ids } })
  },
}
