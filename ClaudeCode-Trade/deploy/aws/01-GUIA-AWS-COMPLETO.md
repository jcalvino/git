# Guia AWS — Passo a Passo (do zero)

> Para quem nunca usou AWS. Todos os passos têm o caminho exato na interface, comandos completos, e explicação do "porquê" de cada decisão.

**Tempo total estimado:** 2–3 horas na primeira vez.
**Custo:** US$ 0 durante **6 meses** (novo Free Tier pós-julho/2025) + US$ 100–200 em créditos. Depois, ~US$ 8,50/mês.
**Região recomendada:** `us-east-1` (N. Virgínia) — tem mais serviços no Free Tier e latência ok para BingX.

> ⚠️ **Atenção — Free Tier mudou em julho de 2025.** Contas criadas depois de **15/07/2025** entram no **novo modelo**:
> - US$ 100 de crédito ao se cadastrar + até US$ 100 adicionais usando serviços.
> - Plano gratuito por **6 meses** (não 12) ou até os créditos acabarem.
> - **"Free account plan"** no cadastro garante que **a AWS não cobra nada**; ao esgotar créditos, sua conta simplesmente pausa até você fazer upgrade.
> - Na prática, para um t3.micro (~US$ 7,60/mês), os US$ 200 em créditos + 6 meses cobrem ~12 meses de uso real. Idêntico ao Free Tier antigo, só com outra mecânica.
> - **Escolha "Free account plan"** no cadastro se quiser garantia total de zero custo.

---

## Sumário

1. [Criar conta AWS com segurança](#1-criar-conta-aws-com-segurança)
2. [MFA na conta root e criação de IAM user](#2-mfa-na-conta-root-e-criação-de-iam-user)
3. [Billing alerts — proteção contra cobrança inesperada](#3-billing-alerts--proteção-contra-cobrança-inesperada)
4. [Lançar EC2 t3.micro (Free Tier)](#4-lançar-ec2-t3micro-free-tier)
5. [Conectar via SSH e hardening inicial](#5-conectar-via-ssh-e-hardening-inicial)
6. [Instalar Tailscale e fechar SSH público](#6-instalar-tailscale-e-fechar-ssh-público)
7. [Deploy do projeto](#7-deploy-do-projeto)
8. [Serviços systemd — rodar 24/7](#8-serviços-systemd--rodar-247)
9. [Primeiro teste end-to-end](#9-primeiro-teste-end-to-end)
10. [O que fazer quando o Free Tier acabar](#10-o-que-fazer-quando-o-free-tier-acabar)

---

## 1. Criar conta AWS com segurança

### 1.1 — Cadastro

1. Acesse https://aws.amazon.com/free e clique **Create a Free Account**.
2. Use um **email dedicado** (ex.: `julio-aws@seudominio.com` ou um Gmail com alias `j.calvino84+aws@gmail.com`). **Não use o mesmo email de outros serviços.** Se esse email vazar, seu atacante já está meio passo na sua conta.
3. Escolha **Personal account**.
4. **Escolha o plano**: prefira **"Free account plan"** (a conta fica bloqueada para pagamentos até você explicitamente fazer upgrade). "Paid account plan" dá mais flexibilidade mas pode cobrar se exceder Free Tier.
5. Cartão de crédito: obrigatório mesmo no plano gratuito. No Free account plan, a AWS usa o cartão apenas para validação de identidade, não cobra. Mesmo assim, vamos colocar billing alerts em alguns minutos.
5. Verificação por SMS + ligação automática.
6. No **Support Plan**, escolha **Basic** (gratuito).

### 1.2 — Login pela primeira vez

Acesse https://console.aws.amazon.com e entre com o email de cadastro. Esse login é o **root user** — acesso total, não deve ser usado no dia a dia.

---

## 2. MFA na conta root e criação de IAM user

**Regra de ouro:** a conta root nunca deve executar ações de rotina. Ela cria um usuário IAM com permissões limitadas e usa esse usuário para tudo.

### 2.1 — MFA no root

1. Canto superior direito → **Security credentials**.
2. Seção **Multi-factor authentication (MFA)** → **Assign MFA device**.
3. Escolha **Authenticator app** (Google Authenticator, Authy, 1Password, etc.).
4. Escaneie o QR code, digite dois códigos consecutivos, concluir.

Agora, logout do root e não volte mais a menos que seja absolutamente necessário.

### 2.2 — Criar IAM user para uso diário

1. Console → pesquise **IAM** → abra o serviço.
2. **Users** → **Create user**.
3. Nome: `julio-admin` (ou seu nome).
4. Marque **Provide user access to the AWS Management Console**.
5. Escolha **I want to create an IAM user**.
6. Senha: custom password (gere uma forte em um gerenciador tipo 1Password/Bitwarden).
7. Desmarque "User must create a new password at next sign-in".
8. **Next** → **Attach policies directly** → marque `AdministratorAccess` (você é o dono da conta; ok para user pessoal).
9. **Next** → **Create user**.
10. Salve o link de sign-in (algo como `https://123456789012.signin.aws.amazon.com/console`), usuário e senha.

### 2.3 — MFA no IAM user também

Faça logout do root, entre com o IAM user recém-criado, repita o passo 2.1. **Tudo que você fizer daqui em diante é logado neste IAM user, nunca mais no root.**

---

## 3. Billing alerts — proteção contra cobrança inesperada

Isso é **inegociável**. Um script mal escrito seu, uma chave AWS vazada, ou um bug pode gerar milhares de dólares de custo em horas. Vamos colocar três camadas.

### 3.1 — Habilitar Free Tier usage alerts

1. Console → canto superior direito, seu nome → **Billing and Cost Management**.
2. Barra lateral → **Billing preferences**.
3. Marque:
   - **Receive AWS Free Tier alerts**
   - **Receive CloudWatch billing alerts**
4. Email: o mesmo do cadastro.
5. **Save preferences**.

### 3.2 — AWS Budget de US$ 1

Cobertura independente: se qualquer custo passar de US$ 1 no mês, você recebe email.

1. Billing and Cost Management → **Budgets** → **Create budget**.
2. **Use a template (simplified)** → **Zero spend budget**. Isso cria um budget de US$ 0,01 que te avisa no primeiro centavo cobrado.
3. Email para alerta: o seu.
4. **Create budget**.

Crie também um **segundo** budget "Monthly cost budget" com valor de US$ 5 (tolerância) para detectar vazamentos menos óbvios.

### 3.3 — CloudWatch billing alarm (defesa em profundidade)

1. Canto superior direito → região → **US East (N. Virginia)** (obrigatório para billing metrics).
2. Console → **CloudWatch** → **Alarms** → **Billing** → **Create alarm**.
3. Metric: `EstimatedCharges`, currency `USD`.
4. Threshold: `Greater than 1.0`.
5. SNS topic: **Create new topic** → nome `billing-alerts` → email de destino.
6. Confirme a inscrição SNS no email que chegar.
7. Salve.

---

## 4. Lançar EC2 t3.micro (Free Tier)

### 4.1 — Key pair (chave SSH)

1. Volte para **US East (N. Virginia)** no canto superior direito (`us-east-1`).
2. Console → **EC2** → barra lateral **Key Pairs** → **Create key pair**.
3. Nome: `claudecode-trade`.
4. Type: **ED25519** (mais moderno e seguro que RSA).
5. Format: **.pem** (OpenSSH).
6. **Create** → o arquivo `claudecode-trade.pem` baixa automaticamente.
7. Mova o arquivo para `C:\Users\jcalv\.ssh\claudecode-trade.pem` e proteja:
   ```powershell
   icacls "C:\Users\jcalv\.ssh\claudecode-trade.pem" /inheritance:r
   icacls "C:\Users\jcalv\.ssh\claudecode-trade.pem" /grant:r "%username%:R"
   ```
   Isso é o equivalente Windows do `chmod 400` — só seu usuário pode ler a chave.

### 4.2 — Security Group

1. EC2 → **Security Groups** → **Create security group**.
2. Nome: `claudecode-trade-sg`.
3. Descrição: `Trading bot EC2 — SSH via Tailscale only`.
4. **VPC**: a default.
5. **Inbound rules** — por enquanto, só uma regra temporária para o setup inicial:
   - Type: **SSH**, Port: `22`, Source: **My IP** (detecta seu IP automaticamente).
   - > **IMPORTANTE:** Essa regra é temporária. Vamos removê-la depois que Tailscale estiver rodando (seção 6).
6. **Outbound rules**: deixe o default (all traffic). Precisamos chamar BingX, Binance, Telegram, apt, npm, etc.
7. **Create**.

### 4.3 — Lançar a instância

1. EC2 → **Instances** → **Launch instances**.
2. Nome: `claudecode-trade-prod`.
3. AMI: **Ubuntu Server 22.04 LTS** (64-bit x86) — marcado "Free tier eligible".
4. Instance type: **t3.micro** (Free tier eligible).
   - Se `t3.micro` não aparecer como free tier na sua região, use `t2.micro`.
5. Key pair: `claudecode-trade` (o que criamos).
6. Network settings → **Edit** → **Select existing security group** → `claudecode-trade-sg`.
7. **Configure storage**: 20 GiB `gp3` (Free Tier permite até 30 GiB).
8. **Advanced details** → vá até **User data** (bem no fim) → cole o conteúdo do arquivo `bootstrap.sh` desta pasta.
   - Esse script roda automaticamente no primeiro boot e instala Node.js, git, fail2ban, PM2, cria o usuário do bot, etc.
9. **Launch instance**.

Aguarde ~2 minutos até a instância ir para **Running** e passar nos **Status checks** (2/2).

### 4.4 — Elastic IP (IP fixo)

Sem Elastic IP, o IP público muda toda vez que você reinicia a instância. Atribuir um EIP a uma instância rodando é **gratuito**. (Só há cobrança se o EIP ficar desatrelado — não deixe EIPs órfãos.)

1. EC2 → barra lateral **Elastic IPs** → **Allocate Elastic IP address**.
2. Aloque, depois **Actions** → **Associate Elastic IP address** → escolha a instância `claudecode-trade-prod`.
3. Anote o IP (ex.: `54.123.45.67`). Esse é o IP público fixo.

---

## 5. Conectar via SSH e hardening inicial

### 5.1 — Primeira conexão SSH

No PowerShell (Windows):

```powershell
ssh -i "C:\Users\jcalv\.ssh\claudecode-trade.pem" ubuntu@54.123.45.67
```

(substitua pelo seu EIP). Aceite a fingerprint. Se conectou, está dentro da sua EC2.

### 5.2 — Verificar que o bootstrap terminou

```bash
sudo tail -n 50 /var/log/cloud-init-output.log
```

Deve mostrar o log do `bootstrap.sh`. Procure por `=== bootstrap.sh finished ===` no fim.

### 5.3 — Rodar hardening

Faça upload do `harden.sh` para a instância (mais fácil depois, na seção 7 quando configurar deploy). Por enquanto, rode o essencial inline:

```bash
# Atualizar pacotes
sudo apt update && sudo apt upgrade -y

# Instalar fail2ban (banimento automático de IPs que tentam brute-force SSH)
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban

# Atualizações de segurança automáticas
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades  # responda Yes

# Desabilitar login por senha (só chaves)
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

---

## 6. Instalar Tailscale e fechar SSH público

**Por quê:** Expor SSH na internet (mesmo restrito ao seu IP) é risco quando seu IP residencial muda, quando você viaja, e quando você precisa acessar do celular em 4G/roaming. Tailscale cria uma **VPN privada** entre seus dispositivos (celular, notebook, EC2) sem abrir nenhuma porta pública.

Free tier do Tailscale: **3 usuários, 100 dispositivos, uso pessoal — ilimitado e grátis**.

### 6.1 — Criar conta Tailscale

1. Acesse https://tailscale.com e faça login com Google/GitHub/Microsoft (use uma conta que você protege com MFA).
2. No dashboard, você verá "0 devices". Vamos adicionar dois: o EC2 e seu celular.

### 6.2 — Instalar no EC2

Na sessão SSH:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --advertise-tags=tag:trade-bot
```

O comando mostrará uma URL. Abra-a no navegador → autorize o device. De volta no terminal, você verá o IP Tailscale da EC2 (algo como `100.x.y.z`).

A flag `--ssh` liga o Tailscale SSH: dispensa chave, usa o MFA da sua conta Tailscale. Muito mais seguro que SSH normal.

### 6.3 — Instalar no celular

1. Baixe o app **Tailscale** (iOS/Android).
2. Login com a mesma conta.
3. Seu celular aparece na rede Tailscale e já consegue pingar o EC2 pelo IP `100.x.y.z`.

### 6.4 — Remover regra SSH pública do Security Group

Agora que Tailscale está funcionando, feche a porta 22 para o mundo.

1. EC2 → Security Groups → `claudecode-trade-sg` → **Inbound rules** → **Edit inbound rules**.
2. **Delete** a regra SSH na porta 22.
3. **Save rules**.

Teste Tailscale SSH (ainda funciona):

```bash
# Do seu laptop (com Tailscale rodando)
ssh ubuntu@<hostname-ou-ip-tailscale>
```

**Agora sua EC2 não tem NENHUMA porta aberta para a internet pública.** Qualquer atacante teria que primeiro comprometer sua conta Tailscale.

---

## 7. Deploy do projeto

### 7.1 — Configurar deploy.sh no seu PC

O arquivo `deploy/aws/deploy.sh` faz:
1. Build do dashboard (`npm run build` em dashboard/).
2. `rsync` do código para `/opt/claudecode-trade` na EC2.
3. `npm ci --omit=dev` remoto.
4. `systemctl restart` dos serviços.

Antes do primeiro deploy, edite essas variáveis no topo de `deploy.sh`:

```bash
REMOTE_HOST="trade-bot"        # hostname Tailscale da EC2
REMOTE_USER="ubuntu"
REMOTE_DIR="/opt/claudecode-trade"
```

### 7.2 — Preparar .env.production

Copie `.env.aws.example` (na raiz do projeto) para `.env.production` **no seu PC** e preencha:

```bash
# APENAS no PC local. Nunca commite este arquivo.
PAPER_TRADE=true          # MANTENHA TRUE por 2 semanas no mínimo
CAPITAL_USDT=1100
BINGX_API_KEY=...
BINGX_SECRET_KEY=...
TELEGRAM_BOT_TOKEN=...    # ver 03-TELEGRAM-BOT.md
TELEGRAM_ALLOWED_CHAT_IDS=123456789
TELEGRAM_PIN=...          # PIN numérico 6 dígitos
ANTHROPIC_API_KEY=sk-ant-...
```

O `deploy.sh` envia esse arquivo com `scp` protegendo permissões (`chmod 600`).

### 7.3 — Primeiro deploy

No seu PC, dentro da pasta do projeto:

```bash
bash deploy/aws/deploy.sh
```

Se houver erro de permissão, confira que seu `deploy.sh` tem executable:

```bash
chmod +x deploy/aws/deploy.sh
```

### 7.4 — Ajustes de bind em api/server.js

No seu projeto, quando você criar `src/api/server.js`, use:

```js
const HOST = process.env.API_HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {...});
```

Na produção (`.env.production`) deixe `API_HOST=127.0.0.1` — o dashboard e o bot vão bater localmente. Nada precisa sair pra internet; Tailscale cuida do acesso externo para você.

---

## 8. Serviços systemd — rodar 24/7

O projeto não usa mais `start.js` em produção. Em vez disso, cada componente é um **service** do systemd: inicia no boot, reinicia automaticamente se cair, logs centralizados em `journalctl`.

Os arquivos estão em `deploy/aws/systemd/`:

| Arquivo | Função |
|---------|--------|
| `claudecode-api.service` | API Express na porta 3001 (loopback) |
| `claudecode-scanner.service` | Scanner cron 4h |
| `claudecode-monitor.service` | Monitor SL/TP a cada 30s |
| `claudecode-telegram.service` | Bot Telegram (sinais + comandos Claude Code) |
| `claudecode-backup.service` + `.timer` | Backup diário do SQLite |

O `bootstrap.sh` já instala e habilita todos. Para gerenciar:

```bash
sudo systemctl status claudecode-scanner
sudo systemctl restart claudecode-api
sudo journalctl -u claudecode-scanner -f      # logs em tempo real
sudo journalctl -u claudecode-api --since "1 hour ago"
```

**Nota:** o dashboard Vite (`npm run dev`) não deve rodar em produção. Se quiser o dashboard na nuvem:
- Opção A (simples): rode `npm run build` no `dashboard/` e sirva estático via nginx (`deploy/aws/nginx.conf`) exposto só dentro da rede Tailscale.
- Opção B (recomendada): não suba dashboard na nuvem. Use o bot Telegram para ver sinais e aprovar trades. Se quiser ver gráficos, abra o dashboard localmente no PC apontando para a API remota via Tailscale (`VITE_API_URL=http://trade-bot:3001`).

---

## 9. Primeiro teste end-to-end

Com tudo deployado:

```bash
# SSH na EC2
ssh ubuntu@trade-bot

# Verificar serviços
sudo systemctl status 'claudecode-*'

# Testar API
curl http://127.0.0.1:3001/api/health

# Testar BingX
cd /opt/claudecode-trade
sudo -u claudebot node src/exchanges/bingx.js

# Rodar um scan manual
sudo -u claudebot node src/bot/scanner.js --once

# Conferir no Telegram
# Mande uma mensagem ao bot: /status
```

Você deve receber resposta do bot e, se houver sinal acima do `MIN_SCORE`, ver a notificação push com botões APROVAR/REJEITAR.

---

## 10. O que fazer quando o Free Tier acabar

Com o modelo pós-2025, seus US$ 200 em créditos + 6 meses de Free Plan cobrem aproximadamente **12 meses** reais de uso de um t3.micro. Depois disso, a EC2 passa a custar ~US$ 8,50/mês. Opções:

1. **Aceitar o custo.** É o mais simples.
2. **Reserved Instance de 1 ano** (~US$ 5/mês paga upfront).
3. **Compute Savings Plans** (~US$ 5/mês com flexibilidade).
4. **Mudar para Oracle Cloud Always Free** — eles oferecem VMs ARM Ampere A1 com até 4 cores + 24 GB RAM **para sempre grátis** (sujeito a capacidade). Seu código é Node.js puro, roda em ARM sem mudança.
5. **AWS Lightsail** — US$ 3,50/mês pelo menor plano (512 MB RAM, pode ser apertado).

Você receberá email da AWS ~30 dias antes do fim do Free Plan / esgotamento de créditos.

---

## Checklist final

- [ ] Conta AWS criada com email dedicado
- [ ] MFA ativado no root
- [ ] IAM user com MFA criado
- [ ] Billing alert em US$ 1 funcionando (teste enviando SNS manual)
- [ ] EC2 t3.micro rodando em `us-east-1`
- [ ] Elastic IP atribuído
- [ ] SSH inicial funcionou
- [ ] fail2ban + unattended-upgrades instalados
- [ ] Tailscale no EC2 + celular + laptop
- [ ] Regra SSH removida do Security Group
- [ ] Bot Telegram respondendo a `/status`
- [ ] Backup diário configurado e testado (`sudo systemctl list-timers`)
- [ ] `.env` em produção com `PAPER_TRADE=true`
- [ ] Plano para revisar em 14 dias antes de mudar para live trading

Tudo marcado? Você tem um ambiente cloud seguro, controlado por celular, a custo zero, rodando seu bot 24/7.
