# Bot Telegram — Setup e Operação

O bot cumpre dois papéis:

1. **Notificações de sinais e trades** (substitui o dashboard quando estiver fora de casa).
2. **Controle remoto do Claude Code** (pedir alterações no projeto direto do celular).

---

## 1. Criar o bot no Telegram

1. No Telegram, abra o **@BotFather**.
2. Envie `/newbot`.
3. Nome: `ClaudeCode Trade (seu nome)`.
4. Username: precisa terminar em `bot`. Ex.: `julio_trade_prod_bot`.
5. BotFather retorna o **token** (algo como `7891234567:AAEabc...`). **Guarde em gerenciador de senhas; nunca commite.**
6. Envie `/setprivacy` → escolha o bot → **Disable** (permite ler mensagens no grupo se quiser).
7. Envie `/setcommands` → cole:

```
status - Visao geral: posicoes abertas, sinais pendentes, ultimo scan
signals - Ultimos 10 sinais gerados
positions - Posicoes abertas com P&L
scan - Forca um scan agora
pause - Pausa o scanner (nao gera sinais ate /resume)
resume - Retoma o scanner
auth - Autentica sessao com PIN
claude - Envia prompt para Claude Code (ex: /claude adicionar indicador RSI/D)
confirm - Confirma operacao destrutiva pendente
help - Lista de comandos
```

---

## 2. Pegar seu chat_id

1. Mande qualquer mensagem para o bot (ex.: "oi").
2. Abra no navegador: `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. Procure `"chat":{"id":123456789,...}`. Esse número é o seu `chat_id`.
4. Coloque em `.env.production`: `TELEGRAM_ALLOWED_CHAT_IDS=123456789`.

Se tiver mais de um dispositivo/pessoa autorizado: separe com vírgula `123,456`.

---

## 3. PIN de sessão

Gere um PIN aleatório de 6 dígitos (não use 123456, não reuse de outros apps):

```bash
# Linux/WSL/Mac
openssl rand -hex 3 | tr 'a-f0-9' '0-9' | cut -c1-6

# Ou em Node
node -e "console.log(Math.floor(100000 + Math.random() * 900000))"
```

Coloque em `.env.production`: `TELEGRAM_PIN=847293`.

---

## 4. Fluxo de autenticação

```
Você (celular) → /status
Bot           → Sessao expirada. Envie /auth <PIN>
Você          → /auth 847293
Bot           → Autenticado. Sessao valida por 4h.
Você          → /status
Bot           → [status report]
```

Sessão expira em 4h de inatividade. Rate limit: 10 comandos/hora por chat.

Após **3 tentativas de PIN erradas**, o `chat_id` é bloqueado por 1h e você recebe alerta em outro canal configurado (`TELEGRAM_ALERT_CHAT_ID`, opcional).

---

## 5. Comandos read-only (não chamam Claude Code)

| Comando | O que faz | Fonte |
|---------|-----------|-------|
| `/status` | Resumo: nº posições, último scan, capital alocado | SQLite + processos |
| `/signals` | Últimos 10 sinais com score | SQLite `signals` |
| `/positions` | Posições abertas, P&L não realizado | SQLite `positions` + BingX |
| `/scan` | Enfileira um scan imediato | `systemctl start claudecode-scanner-once` |
| `/pause` / `/resume` | Pausa/retoma scanner | `systemctl stop/start` |
| `/help` | Lista comandos | constante |

Esses comandos **não** gastam tokens da Anthropic e são rápidos (<1s).

---

## 6. Comando `/claude <prompt>` — Claude Code remoto

Quando você quiser que o Claude Code **modifique o projeto**:

```
Você: /claude ajuste src/strategy/signals.js para somar 10 pontos no score
      quando o RSI semanal estiver abaixo de 30. adicione um teste tambem.
Bot:  [aguardando resposta do Claude Code...]
      
Bot:  Claude Code respondeu:
      Modifiquei src/strategy/signals.js (linhas 45-52) e criei
      tests/signals-rsi.test.js. Diff:
      
      + if (rsiWeekly < 30) score += 10;
      
      Para aplicar: /confirm a3f8c2
Você: /confirm a3f8c2
Bot:  Aplicado. git commit feito. Branch: claude/rsi-boost-1747...
      systemctl reload claudecode-scanner feito.
```

### Como funciona por dentro

1. Bot recebe `/claude <prompt>`.
2. Bot cria um **branch git** `claude/<timestamp>-<slug>`.
3. Bot invoca `claude` CLI em headless mode:
   ```bash
   claude -p "<prompt>" \
     --output-format stream-json \
     --max-turns 20 \
     --permission-mode plan \
     --add-dir /opt/claudecode-trade \
     --disallowedTools "Bash(rm:*)" "Bash(sudo:*)" "Bash(curl:*)" "Bash(wget:*)" "Bash(ssh:*)"
   ```
4. Stream da resposta vai para o chat Telegram (truncado a 4096 chars, dividido em mensagens).
5. Claude Code para após plano → bot retorna o diff proposto + hash de confirmação.
6. Você manda `/confirm <hash>` → bot executa `git add -A && git commit -m "claude: <prompt>"` no branch, faz `git push` (se configurado) e `systemctl reload` dos services afetados.
7. Opcional: `/merge` para fazer merge em `main` (exige segundo confirm).

### Por que `--permission-mode plan`?

No plan mode, Claude Code **propõe** alterações sem executá-las. Você revisa o diff no celular antes de aprovar. Isso é crítico para evitar um comando `/claude` malformado (ou um atacante) fazendo estrago.

---

## 7. Notificações automáticas (push do bot → você)

Eventos que o bot envia sem você pedir:

| Evento | Quando | Ação disponível |
|--------|--------|-----------------|
| Novo sinal >= MIN_SCORE | Scanner terminou | Botões: **APROVAR / REJEITAR** |
| Trade executado | `executor.js` | (somente notificação) |
| Trade fechou (TP/SL) | `monitor.js` | (somente notificação) |
| Service falhou 3x em 1h | systemd alert | Botões: **/status / ignorar** |
| P&L diário < -3% | daily snapshot | Botões: **/pause / continuar** |
| Falha na BingX API (não 4xx/5xx) | qualquer lugar | (somente notificação) |

Todos os botões inline usam `callback_query` e retornam a ação pro bot, que executa e responde.

---

## 8. Configuração no `.env.production`

```bash
# ── Telegram ─────────────────────────
TELEGRAM_BOT_TOKEN=7891234567:AAEabc...
TELEGRAM_ALLOWED_CHAT_IDS=123456789
TELEGRAM_PIN=847293
TELEGRAM_SESSION_HOURS=4
TELEGRAM_RATE_LIMIT_PER_HOUR=10
TELEGRAM_ALERT_CHAT_ID=                # opcional, para alertas de sec

# ── Claude Code ──────────────────────
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MAX_TURNS=20
CLAUDE_MODEL=claude-sonnet-4-6         # ou outro modelo
CLAUDE_WORKDIR=/opt/claudecode-trade
```

---

## 9. Testar o bot localmente (antes do deploy)

No seu PC:

```bash
# Copiar env
cp .env.aws.example .env
# preencher TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_IDS, PIN

npm install
node src/bot/telegram.js
```

No Telegram, envie `/auth <PIN>` depois `/status`. Se responder, funciona.

---

## 10. Troubleshooting

| Problema | Causa provável | Fix |
|----------|----------------|-----|
| Bot não responde | Service não rodando | `sudo systemctl status claudecode-telegram` |
| "Sessão expirada" em loop | Timezone / clock skew | `timedatectl set-ntp true` |
| "401 Unauthorized" Telegram | Token errado | Re-copiar do BotFather |
| Claude não executa | Sem API key / modelo inválido | `claude --version` na EC2 |
| "Permission denied" escrever arquivo | Usuário errado | Service user deve ser `claudebot` e ter perm em `/opt/claudecode-trade` |
| Rate limit do Telegram | > 30 msgs/s | Agrupar notificações, usar `parse_mode` em vez de múltiplas mensagens |

---

## 11. Exemplos de uso real

**Manhã, acordei e quero ver como está:**
```
/auth 847293
/status
/positions
```

**Durante o dia, bot me avisa:**
> ⚠️ Sinal gerado: BTC LONG
> Score: 78/100
> Entry: 84,250  SL: 83,410  TP1: 85,100
> [APROVAR] [REJEITAR] [VER DETALHES]

**À noite, tive uma ideia:**
```
/claude aumente MIN_SCORE para 70 nas sextas-feiras 
        (dia historicamente volatil) e crie um teste
```

Bot responde com diff → /confirm → commit → reload.

**Viajando:**
> 🛑 P&L -4.2% nas ultimas 24h. Pausar scanner?
> [PAUSAR] [CONTINUAR]

---

Próximo passo: ver `src/bot/telegram.js` (esqueleto com todas essas features já conectadas).
