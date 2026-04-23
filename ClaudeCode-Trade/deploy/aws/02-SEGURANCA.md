# Segurança — ClaudeCode-Trade na AWS

O objetivo aqui é **proteger suas chaves de exchange, seu dinheiro na BingX, e o controle da EC2**. Um bot de trading comprometido pode:

- Drená-lo via ordens com spread manipulado.
- Sacar saldo (se a chave tiver `withdraw` — nunca dê isso).
- Usar sua EC2 para ataques a terceiros (você responde).

Vamos em **camadas** (defense in depth). Se uma falhar, a próxima segura.

---

## Camada 1 — Conta AWS

| Controle | Status esperado |
|----------|----------------|
| Email de cadastro dedicado, não usado em outros sites | ✅ |
| MFA hardware ou app em root | ✅ |
| Root nunca usado no dia a dia | ✅ |
| IAM user pessoal com MFA | ✅ |
| Access keys do root **não existem** | ✅ (verifique em IAM → Users → Root → Security credentials) |
| Billing alerts em ≤ US$ 1 | ✅ |
| AWS Budgets + CloudWatch billing alarm (defesa em profundidade) | ✅ |

**Se você suspeitar de comprometimento da conta AWS:** abra Support → Account → comece com "rotate root password + revoke all sessions" e contate o AWS Abuse Team.

---

## Camada 2 — Acesso à EC2

| Controle | Como |
|----------|------|
| Sem IP público exposto (SSH fechado para 0.0.0.0/0) | Security Group sem regra 22 |
| Acesso via Tailscale (VPN privada, MFA) | `sudo tailscale up --ssh` |
| Chave SSH ED25519 protegida (backup em gerenciador) | `~/.ssh/claudecode-trade.pem`, `chmod 400` |
| `PermitRootLogin no`, `PasswordAuthentication no` | `/etc/ssh/sshd_config` |
| fail2ban banindo brute-force | `sudo systemctl status fail2ban` |
| Atualizações de segurança automáticas | `unattended-upgrades` |
| Security Group apenas outbound (nada de inbound) | Depois que Tailscale assumir |
| Fuso horário e NTP corretos | `timedatectl status` |

### Tailscale ACLs (opcional, mas recomendado)

No admin console do Tailscale, defina ACL para limitar quem acessa o EC2 só ao seu usuário:

```json
{
  "tagOwners": {
    "tag:trade-bot": ["autogroup:admin"]
  },
  "acls": [
    { "action": "accept", "src": ["autogroup:admin"], "dst": ["tag:trade-bot:*"] }
  ],
  "ssh": [
    {
      "action": "check",
      "src": ["autogroup:admin"],
      "dst": ["tag:trade-bot"],
      "users": ["ubuntu"],
      "checkPeriod": "12h"
    }
  ]
}
```

Com `"action": "check"`, cada conexão SSH exige reauth via navegador a cada 12h.

---

## Camada 3 — Usuário do sistema

A aplicação **não roda como `ubuntu`** (sudoer). Ela roda num usuário dedicado sem shell interativo nem sudo.

```bash
# Criado pelo bootstrap.sh:
sudo useradd -r -s /usr/sbin/nologin -d /opt/claudecode-trade claudebot
sudo chown -R claudebot:claudebot /opt/claudecode-trade
```

Todos os systemd services têm `User=claudebot` e `Group=claudebot`. Se alguém explorar um bug na sua API HTTP, consegue no máximo o que `claudebot` pode fazer — e ele não pode `sudo`, não pode ler chaves SSH do `ubuntu`, nem modificar systemd.

Hardening adicional nos services (já presente nos `.service`):

```ini
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/claudecode-trade/data /var/backups/claudecode-trade
```

---

## Camada 4 — Gestão de segredos

**Onde NÃO guardar API keys:**

- ❌ Dentro do repositório git (nem em branches privadas).
- ❌ Em variáveis exportadas via `.bashrc` (visíveis por `ps e`).
- ❌ Hardcoded em `.js`.

**Onde guardar, em ordem de preferência:**

1. **AWS Systems Manager Parameter Store** (Free Tier: 10.000 `SecureString` grátis, KMS-encrypted).
2. **`.env.production` com `chmod 600`, dono `claudebot`** — mais simples, suficiente para um projeto solo.

### Opção simples (`.env` protegido)

O `deploy.sh` faz automaticamente:

```bash
scp -p .env.production ubuntu@trade-bot:/tmp/.env.production
ssh ubuntu@trade-bot '
  sudo install -o claudebot -g claudebot -m 600 /tmp/.env.production /opt/claudecode-trade/.env
  sudo rm -f /tmp/.env.production
'
```

Verificar:

```bash
sudo ls -la /opt/claudecode-trade/.env
# -rw------- 1 claudebot claudebot
```

### Opção robusta (Parameter Store)

Para quem quiser: grave cada segredo como `SecureString`:

```bash
aws ssm put-parameter \
  --name "/claudecode-trade/BINGX_API_KEY" \
  --value "xxxxxx" \
  --type SecureString \
  --region us-east-1
```

Dê role IAM à EC2 com permissão `ssm:GetParameter` só nesse prefix. No bootstrap, adicione um script que puxa os parâmetros antes de iniciar os services. Exemplo de policy mínima:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
    "Resource": "arn:aws:ssm:us-east-1:SEU-ACCOUNT-ID:parameter/claudecode-trade/*"
  }]
}
```

> Comece com `.env` protegido. Migre para Parameter Store se o projeto crescer.

---

## Camada 5 — Chave da BingX

Esta é a camada que **mais importa para proteger seu dinheiro**.

### Criar a API key corretamente

BingX → Profile → API Management → Create API:

1. Nome: `claudecode-trade-prod`.
2. Permissões:
   - ✅ **Read**
   - ✅ **Futures Trade**
   - ❌ **NUNCA marque Withdraw**. Não é necessário e se vazar, permite saque direto para a carteira do atacante.
   - ❌ Spot Trade — não usamos.
3. **IP Whitelist**: cole o Elastic IP da EC2 (ex.: `54.123.45.67`). Isso é crítico: sem isso, mesmo com a chave vazando, ordens de outro IP são rejeitadas.

### Rotação periódica

Gere uma nova chave e invalide a antiga a cada **90 dias**. Adicione no seu calendário.

### Monitoramento

No BingX: **Profile → API Management → Operations Log**. Revise semanalmente. Qualquer ordem que você não reconhece → rotate imediatamente.

---

## Camada 6 — Claude Code + Telegram

O bot Telegram executa o Claude Code com sua `ANTHROPIC_API_KEY`. Camadas de defesa:

1. **Whitelist de `chat_id`**: o bot só processa mensagens de IDs específicos em `TELEGRAM_ALLOWED_CHAT_IDS`.
2. **PIN numérico**: primeira mensagem do dia exige `/auth 123456`. Token de sessão expira em 4h.
3. **Rate limit**: máximo 10 comandos por hora por chat.
4. **Comandos em sandbox**: Claude Code roda com flags `--permission-mode default` e working directory limitado a `/opt/claudecode-trade`. Bloqueio de `Bash(rm:*)`, `Bash(curl:*)`, `Bash(wget:*)` via `--disallowedTools` (ver `03-TELEGRAM-BOT.md`).
5. **Auditoria**: toda conversa e chamada de Claude Code é logada em `/var/log/claudecode-trade/telegram.log` com timestamp e `chat_id`.
6. **Modo "read-only" por padrão**: comandos tipo `/status`, `/signals`, `/positions` não chamam Claude Code — puxam direto do SQLite. Só `/claude <prompt>` invoca o LLM.
7. **Confirmação dupla em ações destrutivas**: qualquer ação que Claude Code proponha modificar `.env`, deletar arquivos ou rodar `rm` exige `/confirm <hash>` em mensagem separada.

**Se o seu Telegram for comprometido (celular roubado, SIM swap):** o atacante pode mandar mensagens ao bot com seu `chat_id`. Defesa: sem o PIN, o bot nega. Por isso o PIN **precisa** ser diferente de senhas usadas em outros lugares e só você o sabe.

---

## Camada 7 — Backup e recuperação

### Backup do SQLite

`deploy/aws/backup-db.sh` roda diariamente via `systemd.timer`:

1. Copia `data/trades.db` com `sqlite3 .backup` (consistent snapshot).
2. Compacta em `.db.gz` com timestamp.
3. Salva em `/var/backups/claudecode-trade/`.
4. Retém últimos 14 dias (rotação automática).

Opcional: sync para S3 (Free Tier: 5 GB por 12 meses).

```bash
# No bootstrap.sh (comentado por padrão):
aws s3 sync /var/backups/claudecode-trade s3://seu-bucket/backups \
  --storage-class GLACIER_IR
```

### Recovery plan

Se a EC2 for comprometida ou a instância morrer:

1. Snapshot EBS → Restore.
2. OU: launch nova instância com bootstrap, depois `scp` do `.db.gz` mais recente, `gunzip`, restart services.
3. **Não reuse** a API key da BingX; gere uma nova com IP whitelist novo.

---

## Camada 8 — Rede & outbound

O bot precisa falar com:

| Destino | Porta | Motivo |
|---------|-------|--------|
| `open-api.bingx.com` | 443 | Ordens, preços |
| `fapi.binance.com` | 443 | Klines (opcional, fallback) |
| `open-api.coinglass.com` | 443 | Funding rate, OI, Fear/Greed |
| `api.telegram.org` | 443 | Bot |
| `api.anthropic.com` | 443 | Claude Code |
| `archive.ubuntu.com` etc | 80/443 | apt updates |
| `registry.npmjs.org` | 443 | npm ci |

Se quiser ser paranoico: Security Group Outbound restrito só a 443/80 (bloqueia exfiltração via protocolos exóticos). Em conjunto com `iptables` no EC2:

```bash
# Bloqueia tudo outbound exceto os hosts necessários (experimental)
# Só aplique se souber o que está fazendo; pode quebrar apt.
```

Na prática para projeto solo, allowlist por DNS é frágil (IPs mudam). Fique com Outbound all + monitoring.

---

## Camada 9 — Observabilidade

### Logs

```bash
sudo journalctl -u claudecode-* --since today
sudo tail -f /var/log/claudecode-trade/telegram.log
```

### Alertas críticos (via Telegram)

O bot deve enviar alerta proativo ao seu chat quando:

- `claudecode-scanner.service` cair/reiniciar > 3 vezes em 1h.
- `fail2ban` banir um IP (potencial ataque).
- SSH login bem-sucedido (útil mesmo sendo você — confirma que o acesso é legítimo).
- Saldo BingX cair abaixo de um threshold (ex.: perda > 5% em 24h → pausar scanner).

Exemplos de scripts em `deploy/aws/alerts/` (criar conforme necessidade).

### CloudWatch (Free Tier)

- Basic metrics de CPU, disk, network são grátis e automáticas.
- Detailed monitoring custa → não ligue.
- Crie 1 alarm: **CPU > 80% por 15 min** → provável loop infinito / bot preso.

---

## Runbook — "Alguém está saindo com meu dinheiro"

Se você ver perdas inexplicáveis:

1. **Rotate BingX key imediatamente** (desabilitar a antiga no painel BingX).
2. **Parar services**: `sudo systemctl stop 'claudecode-*'`.
3. **Snapshot do `.env` e logs** para análise: `sudo tar czf /tmp/incident-$(date +%s).tgz /opt/claudecode-trade/.env /var/log/claudecode-trade /var/log/auth.log`.
4. **Verificar logs de auth SSH** (`/var/log/auth.log`) — alguém logou?
5. **Verificar Tailscale admin console** — algum device novo/desconhecido?
6. **Rotate**: Tailscale reauth all, AWS IAM user new password + new MFA, Anthropic API key revoke, Telegram `/revoke`.
7. Só depois disso, reaplicar bootstrap em instância nova e restaurar de backup anterior ao incidente.

---

## Resumo em uma frase

**Tailscale para acesso + usuário do sistema sem privilégio + `.env` com `chmod 600` + BingX key sem withdraw com IP whitelist + Telegram com PIN + backup diário = um alvo pouco interessante.**
