import { serve } from '@hono/node-server'
import { join } from 'node:path'
import { openDb } from './db.ts'
import { createApp } from './app.ts'

const PORT = Number(process.env.PORT ?? 3456)
const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data')
const CORS_ORIGIN = process.env.CORS_ORIGIN
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || undefined
const INACTIVE_DAYS = Number(process.env.INACTIVE_DAYS ?? 180)

const db = openDb(join(DATA_DIR, 'banban.db'))
const { app, purgeExpired, purgeInactive } = createApp({ db, corsOrigin: CORS_ORIGIN, adminToken: ADMIN_TOKEN, inactiveDays: INACTIVE_DAYS })

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
  console.log(`banban server listening on http://${info.address}:${info.port} (db: ${join(DATA_DIR, 'banban.db')})`)
})
const shutdown = () => {
  server.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
