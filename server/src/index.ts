import { serve } from '@hono/node-server'
import { join } from 'node:path'
import { openDb } from './db.ts'
import { createApp, type PushSender } from './app.ts'
import webpush from 'web-push'
import { createAiParser } from './ai.ts'

const PORT = Number(process.env.PORT ?? 3456)
const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data')
const CORS_ORIGIN = process.env.CORS_ORIGIN
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || undefined
const INACTIVE_DAYS = Number(process.env.INACTIVE_DAYS ?? 180)
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? CORS_ORIGIN ?? `http://127.0.0.1:${PORT}`
const SHARE_HTML = process.env.SHARE_HTML ?? join(import.meta.dirname, '..', '..', 'dist', 's', 'index.html')

const ai = createAiParser({ apiKey: process.env.MINIMAX_API_KEY, baseUrl: process.env.MINIMAX_BASE_URL, model: process.env.MINIMAX_MODEL, visionModel: process.env.MINIMAX_VISION_MODEL })
if (!ai.enabled) console.warn('MINIMAX_API_KEY not set: AI receipt parsing disabled')
else if (!process.env.AI_INVITE_CODE && process.env.AI_OPEN !== '1') console.warn('AI enabled but no AI_INVITE_CODE and AI_OPEN!=1: only admin-allowed accounts can use it')

let push: PushSender | undefined
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:admin@chung.men', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
  push = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    async send(sub, payload) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86_400, urgency: 'normal' })
        return true
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) return false
        console.error('push error', code, (e as Error).message)
        return true
      }
    },
  }
} else console.warn('VAPID keys not set: push disabled')

const db = openDb(join(DATA_DIR, 'banban.db'))
const { app, purgeExpired, purgeInactive } = createApp({ db, corsOrigin: CORS_ORIGIN, adminToken: ADMIN_TOKEN, inactiveDays: INACTIVE_DAYS, push, publicOrigin: PUBLIC_ORIGIN, shareHtml: SHARE_HTML, ai, aiDailyQuota: Number(process.env.AI_DAILY_QUOTA ?? 40), aiGlobalDaily: Number(process.env.AI_GLOBAL_DAILY ?? 300), aiInviteCode: process.env.AI_INVITE_CODE || undefined, aiOpen: process.env.AI_OPEN === '1' })

// 每小時：清過期一週以上的分享連結；刪 INACTIVE_DAYS 天沒同步的帳號（連同資料與分享）
const housekeeping = () => {
  purgeExpired()
  const n = purgeInactive()
  if (n) console.log(`purged ${n} inactive account(s)`)
}
setInterval(housekeeping, 3_600_000).unref()
housekeeping()
if (!ADMIN_TOKEN) console.warn('ADMIN_TOKEN not set: /api/admin/stats disabled')

const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
  console.log(`banban server listening on http://${info.address}:${info.port} (db: ${join(DATA_DIR, 'banban.db')}, share html: ${SHARE_HTML}, origin: ${PUBLIC_ORIGIN})`)
})
const shutdown = () => {
  server.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
