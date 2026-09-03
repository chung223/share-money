// Generates PNG icons for the PWA manifest from public/icon.svg.
import sharp from 'sharp'
import { readFileSync } from 'node:fs'

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url))
const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname

await sharp(svg).resize(192, 192).png().toFile(out('pwa-192.png'))
await sharp(svg).resize(512, 512).png().toFile(out('pwa-512.png'))
await sharp(svg).resize(180, 180).png().toFile(out('apple-touch-icon.png'))
// Maskable: pad the artwork so the safe zone (inner 80%) holds the face.
const inner = await sharp(svg).resize(400, 400).png().toBuffer()
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#FFF7F0' } })
  .composite([{ input: inner, left: 56, top: 56 }])
  .png()
  .toFile(out('pwa-512-maskable.png'))
console.log('icons written')
