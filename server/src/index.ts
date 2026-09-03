import { serve } from '@hono/node-server'
import { join } from 'node:path'
import { openDb } from './db.ts'
import { createApp } from './app.ts'

const PORT = Number(process.env.PORT ?? 3456)
const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data')
const CORS_ORIGIN = process.env.CORS_ORIGIN

const db = openDb(join(DATA_DIR, 'banban.db'))
const { app, purgeExpired } = createApp({ db, corsOrigin: CORS_ORIGIN })

// 過期一週以上的分享連結每小時清一次
setInterval(purgeExpired, 3_600_000).unref()
purgeExpired()

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
