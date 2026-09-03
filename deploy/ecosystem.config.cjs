// PM2 設定：pm2 start deploy/ecosystem.config.cjs（以 opc 身分，pm2-opc.service 開機自啟）
// 機密（ADMIN_TOKEN 等）放 /www/banban-data/.env（KEY=VALUE 一行一個，chmod 600），不進 git。
const fs = require('fs')
const secrets = {}
try {
  for (const line of fs.readFileSync('/www/banban-data/.env', 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m) secrets[m[1]] = m[2]
  }
} catch {}

module.exports = {
  apps: [
    {
      name: 'banban',
      script: 'server/src/index.ts',
      cwd: '/www/wwwroot/spilt.chung.men',
      // node:sqlite 與 TypeScript 直接執行都要 Node 22.13+，這台用 ~/.local/node24
      interpreter: '/home/opc/.local/node24/bin/node',
      node_args: '--no-warnings=ExperimentalWarning',
      env: { NODE_ENV: 'production', PORT: '3456', DATA_DIR: '/www/banban-data', CORS_ORIGIN: 'https://spilt.chung.men', PUBLIC_ORIGIN: 'https://spilt.chung.men', INACTIVE_DAYS: '180', FONTCONFIG_FILE: '/www/banban-data/fonts/fonts.conf', ...secrets },
      max_memory_restart: '300M',
      out_file: '/home/opc/.pm2/logs/banban-out.log',
      error_file: '/home/opc/.pm2/logs/banban-err.log',
      time: true,
    },
  ],
}
