import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'node:path'

// Dev-only: /s/<id> -> s/index.html (production nginx does the same with try_files), /api -> local server.
function sharePages(): Plugin {
  return {
    name: 'banban-share-pages',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/s\/[A-Za-z0-9_-]+\/?(\?.*)?$/.test(req.url)) req.url = '/s/index.html'
        next()
      })
    },
  }
}

// BASE_PATH lets the GitHub Pages workflow build under /<repo>/ while local dev stays at /.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), share: resolve(import.meta.dirname, 's/index.html') },
    },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:3456' },
  },
  plugins: [
    react(),
    sharePages(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'mascot.svg'],
      manifest: {
        name: '반반 BanBan 半半分帳',
        short_name: '半半 BanBan',
        description: '可愛又無腦的分帳小幫手：均攤、各點各的、主餐加共享，支援發票掃描與匯率換算。',
        theme_color: '#FFB3C6',
        background_color: '#FFF7F0',
        display: 'standalone',
        start_url: base,
        scope: base,
        lang: 'zh-TW',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Share pages and the API are never the app shell.
        navigateFallbackDenylist: [/^\/s\//, /^\/api\//],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Tesseract worker/core/language data: cache once, reuse offline.
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com',
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-assets', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts' },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/src/**/*.test.ts'],
  },
})
