#!/bin/bash
# 每日備份 banban.db 到 /www/my_www_backup/banban/，保留 30 天。cron：15 4 * * * (opc)
set -euo pipefail
SRC=/www/banban-data/banban.db
DST=/www/my_www_backup/banban
mkdir -p "$DST"
[ -f "$SRC" ] || exit 0
OUT="$DST/banban-$(date +%F).db"
rm -f "$OUT"
/home/opc/.local/node24/bin/node --no-warnings=ExperimentalWarning -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1], { readOnly: true });
db.exec(\"VACUUM INTO '\" + process.argv[2].replace(/'/g, \"''\") + \"'\");
db.close();
" "$SRC" "$OUT"
gzip -f "$OUT"
find "$DST" -name 'banban-*.db.gz' -mtime +30 -delete
echo "$(date '+%F %T') backed up -> $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"
