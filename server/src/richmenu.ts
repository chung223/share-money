/** 產生 Rich Menu 圖（2500×843，4 格）並註冊為預設選單。手動執行：cd server && node --no-warnings=ExperimentalWarning src/richmenu.ts */
import sharp from 'sharp'
import { readFileSync } from 'node:fs'

const W = 2500
const H = 843
const CELLS = [
  { emoji: '📥', label: '收件匣', bg: '#FFB3C6', ink: '#7a2f46' },
  { emoji: '💰', label: '誰欠我', bg: '#B9EDD8', ink: '#1f7a5c' },
  { emoji: '✨', label: '開 App', bg: '#FFE9A8', ink: '#7a5a05' },
  { emoji: '❓', label: '說明', bg: '#D9D4F7', ink: '#4a3d99' },
]
const ICONS: Record<string, string> = {
  // 用簡單向量圖代替 emoji（librsvg 沒有 emoji 字型）
  '📥': '<rect x="-70" y="-30" width="140" height="100" rx="18" fill="#fff" stroke="INK" stroke-width="10"/><path d="M0 -90 v90 M-40 -40 l40 40 l40 -40" stroke="INK" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  '💰': '<circle r="70" fill="#fff" stroke="INK" stroke-width="10"/><text y="26" font-size="76" font-weight="700" text-anchor="middle" fill="INK" font-family="Noto Sans TC">$</text>',
  '✨': '<path d="M0 -85 L18 -18 L85 0 L18 18 L0 85 L-18 18 L-85 0 L-18 -18 Z" fill="#fff" stroke="INK" stroke-width="10" stroke-linejoin="round"/>',
  '❓': '<circle r="70" fill="#fff" stroke="INK" stroke-width="10"/><text y="30" font-size="90" font-weight="700" text-anchor="middle" fill="INK" font-family="Noto Sans TC">?</text>',
}

export function richMenuSvg() {
  const cw = W / CELLS.length
  const cells = CELLS.map((c, i) => {
    const x = i * cw
    return `<g>
      <rect x="${x}" y="0" width="${cw}" height="${H}" fill="${c.bg}"/>
      <g transform="translate(${x + cw / 2} ${H / 2 - 110})">${ICONS[c.emoji].replace(/INK/g, c.ink)}</g>
      <text x="${x + cw / 2}" y="${H / 2 + 160}" font-family="Noto Sans TC" font-size="96" font-weight="700" fill="${c.ink}" text-anchor="middle">${c.label}</text>
    </g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${cells.join('')}
  ${CELLS.slice(1).map((_, i) => `<rect x="${(i + 1) * (W / CELLS.length) - 4}" y="0" width="8" height="${H}" fill="#ffffff" opacity="0.6"/>`).join('')}
  </svg>`
}

export function richMenuDefinition() {
  const cw = W / CELLS.length
  const actions = [
    { type: 'postback', data: 'inbox', displayText: '📥 收件匣' },
    { type: 'postback', data: 'balances', displayText: '💰 誰欠我' },
    { type: 'uri', uri: 'https://spilt.chung.men' },
    { type: 'postback', data: 'help', displayText: '❓ 說明' },
  ]
  return {
    size: { width: W, height: H },
    selected: true,
    name: 'banban-main',
    chatBarText: '반반 選單',
    areas: CELLS.map((_, i) => ({ bounds: { x: Math.round(i * cw), y: 0, width: Math.round(cw), height: H }, action: actions[i] })),
  }
}

async function main() {
  const envText = readFileSync('/www/banban-data/.env', 'utf8')
  const token = /^LINE_CHANNEL_ACCESS_TOKEN=(.+)$/m.exec(envText)?.[1]?.trim()
  if (!token) throw new Error('no LINE_CHANNEL_ACCESS_TOKEN')
  const H_ = { authorization: `Bearer ${token}` }
  // 清掉舊的
  const list = (await (await fetch('https://api.line.me/v2/bot/richmenu/list', { headers: H_ })).json()) as { richmenus?: { richMenuId: string; name: string }[] }
  for (const m of list.richmenus ?? []) if (m.name === 'banban-main') await fetch(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: 'DELETE', headers: H_ })
  const created = (await (await fetch('https://api.line.me/v2/bot/richmenu', { method: 'POST', headers: { ...H_, 'content-type': 'application/json' }, body: JSON.stringify(richMenuDefinition()) })).json()) as { richMenuId?: string; message?: string }
  if (!created.richMenuId) throw new Error('create failed: ' + JSON.stringify(created))
  const png = await sharp(Buffer.from(richMenuSvg())).png().toBuffer()
  const up = await fetch(`https://api-data.line.me/v2/bot/richmenu/${created.richMenuId}/content`, { method: 'POST', headers: { ...H_, 'content-type': 'image/png' }, body: new Uint8Array(png) })
  if (!up.ok) throw new Error('upload failed: ' + (await up.text()))
  const def = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${created.richMenuId}`, { method: 'POST', headers: H_ })
  if (!def.ok) throw new Error('set default failed: ' + (await def.text()))
  console.log('rich menu ready:', created.richMenuId, png.length, 'bytes')
}
if (process.argv[1]?.endsWith('richmenu.ts')) main().catch((e) => { console.error(e); process.exit(1) })
