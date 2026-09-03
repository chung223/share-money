/**
 * LINE Messaging API 最小封裝：簽章驗證、reply、push、抓圖、抓 profile。
 * 只在設定 LINE_CHANNEL_SECRET + LINE_CHANNEL_ACCESS_TOKEN 時啟用。Reply 免費、Push 吃官方帳號額度。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface LineClient {
  enabled: boolean
  verify(body: string, signature: string | undefined): boolean
  reply(replyToken: string, messages: unknown[]): Promise<void>
  push(to: string, messages: unknown[]): Promise<boolean>
  getContent(messageId: string): Promise<{ mediaType: string; base64: string } | null>
  getProfile(userId: string): Promise<{ displayName: string; pictureUrl?: string } | null>
}

export function createLineClient(opts: { channelSecret?: string; accessToken?: string; fetchFn?: typeof fetch }): LineClient {
  const { channelSecret, accessToken, fetchFn = fetch } = opts
  if (!channelSecret || !accessToken) {
    return { enabled: false, verify: () => false, reply: async () => {}, push: async () => false, getContent: async () => null, getProfile: async () => null }
  }
  const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }
  return {
    enabled: true,
    verify(body, signature) {
      if (!signature) return false
      const mac = createHmac('sha256', channelSecret).update(body).digest()
      let given: Buffer
      try {
        given = Buffer.from(signature, 'base64')
      } catch {
        return false
      }
      return given.length === mac.length && timingSafeEqual(given, mac)
    },
    async reply(replyToken, messages) {
      const r = await fetchFn('https://api.line.me/v2/bot/message/reply', { method: 'POST', headers, body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }) })
      if (!r.ok) console.error('line reply failed', r.status, (await r.text()).slice(0, 200))
    },
    async push(to, messages) {
      const r = await fetchFn('https://api.line.me/v2/bot/message/push', { method: 'POST', headers, body: JSON.stringify({ to, messages: messages.slice(0, 5) }) })
      if (!r.ok) console.error('line push failed', r.status, (await r.text()).slice(0, 200))
      return r.ok
    },
    async getContent(messageId) {
      const r = await fetchFn(`https://api-data.line.me/v2/bot/message/${messageId}/content`, { headers: { authorization: `Bearer ${accessToken}` } })
      if (!r.ok) return null
      const mediaType = r.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > 6_000_000) return null
      return { mediaType, base64: buf.toString('base64') }
    },
    async getProfile(userId) {
      const r = await fetchFn(`https://api.line.me/v2/bot/profile/${userId}`, { headers: { authorization: `Bearer ${accessToken}` } })
      return r.ok ? ((await r.json()) as { displayName: string; pictureUrl?: string }) : null
    },
  }
}

export const LINE_HELP = ['👋 我是 반반 BanBan 分帳小幫手！', '', '1️⃣ 先到 App 設定頁「LINE 機器人」拿連結碼，傳「連結 XXXXXX」給我', '2️⃣ 之後直接傳「收據照片」或「一句話」給我，例如：', '　昨天跟小明小華吃拉麵 900 我付的', '3️⃣ 打開 App 就會看到草稿，一鍵建帳本 ✨', '', '👉 https://spilt.chung.men'].join('\n')
