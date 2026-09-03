/// <reference lib="webworker" />
/* 自訂 Service Worker（vite-plugin-pwa injectManifest）：預快取 + 導覽 fallback + OCR/字型快取 + Web Push。 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

declare let self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// 分享頁與 API 不是 app shell
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/s\//, /^\/api\//] }))

registerRoute(
  ({ url }) => url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com',
  new CacheFirst({ cacheName: 'ocr-assets', plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 })] }),
)
registerRoute(({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com', new StaleWhileRevalidate({ cacheName: 'fonts' }))

// prompt 模式：頁面按「更新」時送 SKIP_WAITING
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('push', (e) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {}
  try {
    data = e.data?.json() ?? {}
  } catch {
    data = { body: e.data?.text() }
  }
  e.waitUntil(
    self.registration.showNotification(data.title ?? '반반 BanBan', {
      body: data.body ?? '有新的動態',
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      tag: data.tag ?? 'banban',
      data: { url: data.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL((e.notification.data as { url?: string })?.url ?? '/', self.location.origin).href
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.startsWith(self.location.origin) && 'focus' in c) return c.focus()
      return self.clients.openWindow(url)
    }),
  )
})
