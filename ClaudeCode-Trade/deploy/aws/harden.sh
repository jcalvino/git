#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# harden.sh — Hardening adicional (idempotente)
# Rode DEPOIS do bootstrap.sh E depois de instalar Tailscale, com sudo.
#
# ⚠ ATENÇÃO: este script configura UFW para bloquear SSH vindo
# de fora da rede Tailscale (100.64.0.0/10). Se você rodar ANTES
# de instalar Tailscale, vai perder acesso SSH à EC2!
#
# Usage: sudo bash harden.sh
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

# Guard: verifica se Tailscale está ativo antes de aplicar UFW
if ! command -v tailscale >/dev/null 2>&1 || ! tailscale status >/dev/null 2>&1; then
  echo "❌ Tailscale não está rodando. Instale e conecte antes de rodar harden.sh." >&2
  echo "   curl -fsSL https://tailscale.com/install.sh | sh" >&2
  echo "   sudo tailscale up --ssh" >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Rode com sudo." >&2
  exit 1
fi

echo "[harden] atualizando pacotes..."
apt-get update -y
apt-get upgrade -y

echo "[harden] verificando/instalando fail2ban, unattended-upgrades..."
apt-get install -y fail2ban unattended-upgrades
systemctl enable --now fail2ban
systemctl enable --now unattended-upgrades

echo "[harden] endurecendo sshd_config..."
SSHD=/etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' $SSHD
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' $SSHD
sed -i 's/^#*X11Forwarding.*/X11Forwarding no/' $SSHD
sed -i 's/^#*PermitEmptyPasswords.*/PermitEmptyPasswords no/' $SSHD
sed -i 's/^#*MaxAuthTries.*/MaxAuthTries 3/' $SSHD
sed -i 's/^#*ClientAliveInterval.*/ClientAliveInterval 300/' $SSHD
sed -i 's/^#*ClientAliveCountMax.*/ClientAliveCountMax 2/' $SSHD
# Validar antes de restart
sshd -t
systemctl restart ssh

echo "[harden] hardening de sysctl (rede)..."
cat > /etc/sysctl.d/99-claudecode-hardening.conf <<'EOF'
# Bloqueia IP spoofing
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
# Ignora ICMP broadcasts
net.ipv4.icmp_echo_ignore_broadcasts = 1
# Ignora pacotes ICMP malformados
net.ipv4.icmp_ignore_bogus_error_responses = 1
# SYN cookies (proteção SYN flood)
net.ipv4.tcp_syncookies = 1
# Log pacotes com endereço impossível
net.ipv4.conf.all.log_martians = 1
# Desativa source routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
# Desativa redirecionamentos ICMP
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
EOF
sysctl --system

echo "[harden] configurando UFW (local firewall)..."
# Permitir apenas tráfego de saída + tráfego Tailscale (100.64.0.0/10) + SSH
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
# Tailscale CGNAT range — permite SSH dos peers Tailscale sem expor 22 publicamente
ufw allow from 100.64.0.0/10 to any port 22 proto tcp
ufw --force enable
ufw status verbose

echo "[harden] logrotate para logs da aplicação..."
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

echo "[harden] conferindo status fail2ban..."
fail2ban-client status sshd || true

echo "[harden] concluído. Resumo:"
echo "  - SSH: apenas por chave"
echo "  - fail2ban: ativo"
echo "  - unattended-upgrades: ativo"
echo "  - UFW: deny incoming exceto 22 via Tailscale (100.64/10)"
echo "  - sysctl: hardening aplicado"
echo ""
echo "Próximo passo: remover a regra SSH pública (0.0.0.0/0:22) do Security Group da AWS."
