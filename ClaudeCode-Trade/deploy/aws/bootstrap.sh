#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# bootstrap.sh — EC2 first-boot setup
# Cole este arquivo INTEIRO no campo "User data" da EC2 no lançamento.
# Roda como root no primeiro boot; output em /var/log/cloud-init-output.log
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

echo "=== bootstrap.sh started $(date -Iseconds) ==="

# ── 1. Atualizar sistema ────────────────────────────────────────
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

# ── 2. Pacotes essenciais ───────────────────────────────────────
apt-get install -y \
  curl wget git rsync jq \
  build-essential \
  sqlite3 \
  fail2ban \
  unattended-upgrades \
  ufw \
  logrotate \
  ca-certificates gnupg

# ── 3. Node.js 20 LTS via NodeSource ────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v
npm -v

# ── 4. Claude Code CLI (instalar globalmente) ───────────────────
# Só instala se estiver disponível no npm. Se falhar, continua — o bot
# Telegram responde aos comandos read-only normalmente.
npm install -g @anthropic-ai/claude-code || echo "Claude Code install falhou — instalar manualmente depois"

# ── 5. Criar usuário dedicado para a aplicação ──────────────────
if ! id claudebot >/dev/null 2>&1; then
  useradd -r -m -d /opt/claudecode-trade -s /usr/sbin/nologin claudebot
fi

# ── 6. Estrutura de diretórios ──────────────────────────────────
mkdir -p /opt/claudecode-trade/data
mkdir -p /var/log/claudecode-trade
mkdir -p /var/backups/claudecode-trade
chown -R claudebot:claudebot /opt/claudecode-trade /var/log/claudecode-trade /var/backups/claudecode-trade
chmod 750 /opt/claudecode-trade /var/log/claudecode-trade /var/backups/claudecode-trade

# ── 7. SSH hardening ────────────────────────────────────────────
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*X11Forwarding.*/X11Forwarding no/' /etc/ssh/sshd_config
systemctl restart ssh

# ── 8. fail2ban ─────────────────────────────────────────────────
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port    = ssh
logpath = %(sshd_log)s
backend = systemd
EOF
systemctl enable --now fail2ban

# ── 9. Unattended upgrades ──────────────────────────────────────
cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades

# ── 10. Logrotate para os logs da aplicação ─────────────────────
cat > /etc/logrotate.d/claudecode-trade <<'EOF'
/var/log/claudecode-trade/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 claudebot claudebot
}
EOF

# ── 11. Permitir que claudebot rode systemctl start/stop apenas nos services dele ─
cat > /etc/sudoers.d/claudebot <<'EOF'
# Claudebot pode gerenciar APENAS seus próprios services, sem senha
claudebot ALL=(root) NOPASSWD: /bin/systemctl start claudecode-scanner, /bin/systemctl stop claudecode-scanner, /bin/systemctl restart claudecode-scanner, /bin/systemctl start claudecode-api, /bin/systemctl stop claudecode-api, /bin/systemctl restart claudecode-api, /bin/systemctl start claudecode-monitor, /bin/systemctl stop claudecode-monitor, /bin/systemctl restart claudecode-monitor, /bin/systemctl is-active claudecode-*
EOF
chmod 440 /etc/sudoers.d/claudebot
visudo -c -f /etc/sudoers.d/claudebot

# ── 12. Timezone + NTP ──────────────────────────────────────────
timedatectl set-timezone America/Sao_Paulo || true
timedatectl set-ntp true || true

echo "=== bootstrap.sh finished $(date -Iseconds) ==="
echo ""
echo "Próximos passos:"
echo "  1. Conectar via SSH (ubuntu@<elastic-ip>)"
echo "  2. Instalar Tailscale: curl -fsSL https://tailscale.com/install.sh | sh"
echo "  3. Remover regra SSH pública do Security Group"
echo "  4. Deploy do projeto: rodar deploy.sh no seu PC local"
