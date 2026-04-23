#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# deploy.sh — Deploy local → EC2 via SSH (Tailscale)
# Usage (do seu PC, dentro do projeto):
#   bash deploy/aws/deploy.sh
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configure estas variáveis ────────────────────────────────────
REMOTE_HOST="${REMOTE_HOST:-trade-bot}"     # hostname Tailscale ou IP
REMOTE_USER="${REMOTE_USER:-ubuntu}"
REMOTE_DIR="${REMOTE_DIR:-/opt/claudecode-trade}"
LOCAL_ENV="${LOCAL_ENV:-.env.production}"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=accept-new}"

if [[ ! -f "$LOCAL_ENV" ]]; then
  echo "❌ $LOCAL_ENV não encontrado. Copie .env.aws.example e preencha." >&2
  exit 1
fi

# ── 1. Build do dashboard (se existir) ──────────────────────────
if [[ -d "dashboard" && -f "dashboard/package.json" ]]; then
  echo "[deploy] Building dashboard..."
  (cd dashboard && npm ci && npm run build)
fi

# ── 2. Sincronizar código ───────────────────────────────────────
echo "[deploy] rsync → $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR"

# .rsync-filter suporta o padrão ".cvs-filter" — usamos --exclude-from
cat > /tmp/deploy-exclude <<'EOF'
.env
.env.*
.git
node_modules
data/*.db
data/*.log
data/pids.json
data/last-scan.json
data/market_metrics.json
data/monitors_state.json
dashboard/node_modules
tv-mcp
*.log
.DS_Store
Thumbs.db
deploy/aws/*.pem
EOF

rsync -avz --delete \
  --exclude-from=/tmp/deploy-exclude \
  -e "ssh $SSH_OPTS" \
  ./ "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"

rm -f /tmp/deploy-exclude

# ── 3. Upload do .env com permissões seguras ────────────────────
echo "[deploy] Enviando .env..."
scp $SSH_OPTS "$LOCAL_ENV" "$REMOTE_USER@$REMOTE_HOST:/tmp/.env.new"
ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "
  sudo install -o claudebot -g claudebot -m 600 /tmp/.env.new $REMOTE_DIR/.env
  sudo rm -f /tmp/.env.new
"

# ── 4. npm ci remoto ────────────────────────────────────────────
echo "[deploy] npm ci (production)..."
ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "
  cd $REMOTE_DIR &&
  sudo chown -R claudebot:claudebot . &&
  sudo -u claudebot npm ci --omit=dev --no-audit --no-fund
"

# ── 5. Instalar systemd units (idempotente) ─────────────────────
echo "[deploy] Instalando systemd units..."
ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "
  sudo install -m 644 $REMOTE_DIR/deploy/aws/systemd/*.service /etc/systemd/system/
  sudo install -m 644 $REMOTE_DIR/deploy/aws/systemd/*.timer /etc/systemd/system/ 2>/dev/null || true
  sudo install -m 755 $REMOTE_DIR/deploy/aws/backup-db.sh /usr/local/bin/claudecode-backup-db
  sudo systemctl daemon-reload
"

# ── 6. Habilitar e reiniciar services ───────────────────────────
echo "[deploy] Habilitando + restart services..."
ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "
  sudo systemctl enable --now claudecode-api.service
  sudo systemctl enable --now claudecode-scanner.service
  sudo systemctl enable --now claudecode-monitor.service
  sudo systemctl enable --now claudecode-telegram.service
  sudo systemctl enable --now claudecode-backup.timer
  sudo systemctl restart claudecode-api claudecode-scanner claudecode-monitor claudecode-telegram
"

# ── 7. Verificar status ─────────────────────────────────────────
echo "[deploy] Status:"
ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "
  sudo systemctl is-active claudecode-api claudecode-scanner claudecode-monitor claudecode-telegram
"

echo "[deploy] Feito!"
echo "Ver logs: ssh $REMOTE_USER@$REMOTE_HOST 'sudo journalctl -u claudecode-* -f'"
