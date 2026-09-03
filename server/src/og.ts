/** Open Graph 預覽圖：1200×630 PNG，SVG → sharp。文字用 Noto Sans TC（FONTCONFIG_FILE 指到 /www/banban-data/fonts）。 */
import sharp from 'sharp'

const W = 1200
const H = 630

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
/** 去掉 emoji 與奇怪符號（字型畫不出來會變豆腐），最多兩行。 */
function cleanTitle(s: string) {
  return s
    .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}
function wrap(s: string, perLine: number, maxLines: number) {
  const lines: string[] = []
  let cur = ''
  for (const ch of s) {
    cur += ch
    if ([...cur].length >= perLine) {
      lines.push(cur)
      cur = ''
      if (lines.length === maxLines) break
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  if ([...s].length > perLine * maxLines) lines[maxLines - 1] = [...lines[maxLines - 1]].slice(0, perLine - 1).join('') + '…'
  return lines
}

// 반반이：左粉右綠的飯糰，同 src/components/ui.tsx 的 Mascot
function mascot(x: number, y: number, size: number, mood: 'happy' | 'wow' | 'sleepy') {
  const path = 'M60 14 C 90 14, 108 40, 108 66 C 108 92, 88 108, 60 108 C 32 108, 12 92, 12 66 C 12 40, 30 14, 60 14 Z'
  const face =
    mood === 'sleepy'
      ? '<path d="M40 62 q6 4 12 0" stroke="#3b2e2a" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M68 62 q6 4 12 0" stroke="#3b2e2a" stroke-width="3.5" fill="none" stroke-linecap="round"/>'
      : mood === 'wow'
        ? '<circle cx="46" cy="60" r="5" fill="#3b2e2a"/><circle cx="74" cy="60" r="5" fill="#3b2e2a"/><ellipse cx="60" cy="80" rx="6" ry="7" fill="#3b2e2a"/>'
        : '<circle cx="46" cy="62" r="4" fill="#3b2e2a"/><circle cx="74" cy="62" r="4" fill="#3b2e2a"/><path d="M52 78 q8 8 16 0" stroke="#3b2e2a" stroke-width="3.5" fill="none" stroke-linecap="round"/>'
  return `<g transform="translate(${x} ${y}) scale(${size / 120})">
    <defs><clipPath id="mc"><path d="${path}"/></clipPath></defs>
    <g clip-path="url(#mc)"><rect x="0" y="0" width="60" height="120" fill="#ffb3c6"/><rect x="60" y="0" width="60" height="120" fill="#b9edd8"/></g>
    <path d="${path}" fill="none" stroke="#3b2e2a" stroke-width="4"/>
    ${face}
    <circle cx="34" cy="74" r="6" fill="#ff9eb5" opacity="0.8"/><circle cx="86" cy="74" r="6" fill="#ff9eb5" opacity="0.8"/>
    <path d="M60 14 v-6" stroke="#3b2e2a" stroke-width="4" stroke-linecap="round"/><circle cx="60" cy="5" r="4" fill="#ffe9a8" stroke="#3b2e2a" stroke-width="3"/>
  </g>`
}

export interface OgInput {
  title: string
  subtitle: string
  mood?: 'happy' | 'wow' | 'sleepy'
}

export function ogSvg({ title, subtitle, mood = 'wow' }: OgInput) {
  const lines = wrap(cleanTitle(title) || '有人幫你先付了', 13, 2)
  const fontSize = lines.some((l) => [...l].length > 9) ? 64 : 80
  const titleY = lines.length === 1 ? 300 : 262
  const dots = Array.from({ length: 60 }, (_, i) => `<circle cx="${(i * 97) % W}" cy="${(i * 53) % H}" r="3" fill="#ff8fab" opacity="0.18"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#fff7f0"/>
  ${dots}
  <rect x="48" y="48" width="${W - 96}" height="${H - 96}" rx="48" fill="#ffffff" stroke="#ffb3c6" stroke-width="6"/>
  ${mascot(760, 150, 330, mood)}
  <g font-family="Noto Sans TC, sans-serif" fill="#3b2e2a">
    ${lines.map((l, i) => `<text x="110" y="${titleY + i * (fontSize + 14)}" font-size="${fontSize}" font-weight="700">${esc(l)}</text>`).join('')}
    <text x="110" y="${titleY + lines.length * (fontSize + 14) + 24}" font-size="34" font-weight="700" fill="#9a8b85">${esc(cleanTitle(subtitle))}</text>
    <rect x="110" y="470" width="360" height="72" rx="36" fill="#ff8fab"/>
    <text x="290" y="519" font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle">點開看你的份</text>
    <text x="1090" y="560" font-size="30" font-weight="700" fill="#b8365a" text-anchor="end">BanBan 半半分帳</text>
  </g>
</svg>`
}

const cache = new Map<string, { buf: Buffer; at: number }>()
export async function renderOg(input: OgInput): Promise<Buffer> {
  const key = JSON.stringify(input)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 3_600_000) return hit.buf
  const buf = await sharp(Buffer.from(ogSvg(input))).png({ compressionLevel: 9 }).toBuffer()
  if (cache.size > 200) cache.clear()
  cache.set(key, { buf, at: Date.now() })
  return buf
}
