/**
 * 催款梗圖：MiniMax image-01 畫可愛底圖 → sharp 疊上名字、金額、一句話（中文用 Noto Sans TC，AI 直接畫字會亂）。
 * 圖存 DATA_DIR/memes/<id>.png，由 /api/meme/:id.png 公開提供（id 不可猜），給 LINE / 分享用。
 */
import sharp from 'sharp'
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export type Mood = 'cute' | 'angry' | 'sad' | 'party'

export interface ImageGen {
  enabled: boolean
  generate(prompt: string): Promise<Buffer>
}

export function createMiniMaxImageGen(opts: { apiKey?: string; baseUrl?: string; fetchFn?: typeof fetch }): ImageGen {
  const { apiKey, baseUrl = 'https://api.minimaxi.com/v1', fetchFn = fetch } = opts
  if (!apiKey) return { enabled: false, generate: async () => Buffer.alloc(0) }
  return {
    enabled: true,
    async generate(prompt) {
      const r = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/image_generation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'image-01', prompt, aspect_ratio: '1:1', response_format: 'base64', n: 1 }),
      })
      if (!r.ok) throw new Error(`minimax image ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const j = (await r.json()) as { data?: { image_base64?: string[]; image_urls?: string[] }; base_resp?: { status_code?: number; status_msg?: string } }
      if (j.base_resp?.status_code) throw new Error(`minimax image ${j.base_resp.status_code}: ${j.base_resp.status_msg}`)
      const b64 = j.data?.image_base64?.[0]
      if (b64) return Buffer.from(b64, 'base64')
      const url = j.data?.image_urls?.[0]
      if (url) return Buffer.from(await (await fetchFn(url)).arrayBuffer())
      throw new Error('minimax image: empty response')
    },
  }
}

const MOOD_PROMPT: Record<Mood, string> = {
  cute: 'a round rice-ball mascot, half pastel pink half mint, big sparkly eyes, holding a tiny gold coin and looking up hopefully, soft pastel colors',
  angry: 'a round rice-ball mascot, half pastel pink half mint, puffed cheeks and a cute pouting angry face, tiny steam puffs, holding an empty wallet, soft pastel colors',
  sad: 'a round rice-ball mascot, half pastel pink half mint, teary puppy eyes, holding an empty piggy bank, soft pastel colors',
  party: 'a round rice-ball mascot, half pastel pink half mint, celebrating with confetti and a party hat, holding a gold coin, soft pastel colors',
}
export function memePrompt(mood: Mood) {
  return `cute kawaii sticker illustration, ${MOOD_PROMPT[mood]}, thick clean outlines, flat shading, plain cream background, centered, lots of empty space at the bottom, no text, no letters, no watermark`
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function strip(s: string) {
  return s.replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim()
}

/** 在 1024×1024 底圖上疊：上方名字氣泡、下方金額橫幅、一句話。 */
export async function composeMeme(base: Buffer, o: { name: string; amountText: string; line: string }): Promise<Buffer> {
  const W = 1024
  const name = strip(o.name).slice(0, 12)
  const amount = strip(o.amountText).slice(0, 16)
  const line = strip(o.line).slice(0, 22)
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
    <g font-family="Noto Sans TC, sans-serif" font-weight="700" text-anchor="middle">
      <rect x="${W / 2 - 300}" y="40" width="600" height="110" rx="55" fill="#ffffff" stroke="#3b2e2a" stroke-width="6"/>
      <text x="${W / 2}" y="115" font-size="60" fill="#3b2e2a">${esc(name)}～</text>
      <rect x="${W / 2 - 360}" y="${W - 300}" width="720" height="150" rx="40" fill="#FF8FAB" stroke="#3b2e2a" stroke-width="6"/>
      <text x="${W / 2}" y="${W - 195}" font-size="92" fill="#ffffff">${esc(amount)}</text>
      <rect x="${W / 2 - 330}" y="${W - 112}" width="660" height="80" rx="30" fill="#fff7f0" opacity="0.92"/>
      <text x="${W / 2}" y="${W - 58}" font-size="46" fill="#3b2e2a">${esc(line)}</text>
    </g>
  </svg>`
  return sharp(base).resize(W, W, { fit: 'cover' }).composite([{ input: Buffer.from(overlay) }]).png({ compressionLevel: 8 }).toBuffer()
}

export function memeStore(dir: string) {
  mkdirSync(dir, { recursive: true })
  return {
    save(buf: Buffer) {
      const id = randomBytes(12).toString('base64url')
      writeFileSync(join(dir, `${id}.png`), buf)
      return id
    },
    read(id: string): Buffer | null {
      if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return null
      const f = join(dir, `${id}.png`)
      return existsSync(f) ? readFileSync(f) : null
    },
    purge(maxAgeMs: number) {
      const cutoff = Date.now() - maxAgeMs
      let n = 0
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).mtimeMs < cutoff) {
          unlinkSync(p)
          n++
        }
      }
      return n
    },
  }
}

export const MEME_LINES: Record<Mood, string[]> = {
  cute: ['記得轉給我唷', '想到再轉就好', '謝謝你最棒了'],
  angry: ['還沒還喔！', '快轉快轉', '不要裝沒看到'],
  sad: ['錢包空空了', '嗚嗚等你轉', '拜託了'],
  party: ['收齊會撒花', '轉完一起慶祝', '差你這一筆'],
}
