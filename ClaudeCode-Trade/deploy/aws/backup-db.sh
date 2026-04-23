#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# backup-db.sh — Backup consistente do SQLite
# Instalado em /usr/local/bin/claudecode-backup-db
# Chamado por claudecode-backup.timer (diário)
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SRC="${DB_PATH:-/opt/claudecode-trade/data/trades.db}"
DEST_DIR="/var/backups/claudecode-trade"
STAMP=$(date +%Y%m%d-%H%M%S)
DEST="$DEST_DIR/trades-$STAMP.db"

mkdir -p "$DEST_DIR"

if [[ ! -f "$SRC" ]]; then
  echo "[backup] $SRC não existe ainda (projeto sem dados) — skip"
  exit 0
fi

# Snapshot consistente usando sqlite3 .backup (transacional)
sqlite3 "$SRC" ".backup '$DEST'"
gzip -9 "$DEST"

# Retenção: 14 dias
find "$DEST_DIR" -name 'trades-*.db.gz' -mtime +14 -delete

echo "[backup] $(date -Iseconds) → $DEST.gz ($(du -h "$DEST.gz" | cut -f1))"

# ── Opcional: sync para S3 ──────────────────────────────────────
# Descomente e configure role IAM + bucket se quiser backup off-site.
#
# if command -v aws >/dev/null 2>&1; then
#   aws s3 cp "$DEST.gz" "s3://SEU-BUCKET/claudecode-trade/" \
#     --storage-class GLACIER_IR \
#     --only-show-errors
# fi
