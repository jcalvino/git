# SETUP_TELEGRAM.md

Guia passo-a-passo pra ativar os alertas do bot no Telegram (Fase 1 — só
recebe, ainda não responde a comandos).

Depois desta fase você passa a receber no celular:

- Cada novo sinal gerado pelo scanner (com entry / SL / TP1 / TP2 / TP3)
- Cada trade aberto pelo executor (paper ou live)
- Cada TP parcial batido (TP1, TP2, TP3) e cada SL
- Erros críticos dos serviços
- Pings de startup do scanner e do monitor

Nada muda na execução dos trades — se o Telegram estiver offline ou
desligado, o bot continua operando normal; só o alerta deixa de chegar.

---

## 1. Criar o bot no Telegram (2 min)

1. Abra o Telegram e procure por **@BotFather** (o verificado, com selo azul).
2. Mande `/newbot`.
3. Nome de exibição: qualquer coisa (ex.: `Julio Trading Bot`).
4. Username: precisa terminar em `bot`. Ex.: `julio_tv_bingx_bot`.
5. O BotFather responde com um **token** no formato
   `123456789:ABCdefGhIJKlmNoPQrsTUVwxyz-0123456789`.

Guarde esse token. Ele vai no `.env` do projeto.

Opcional mas recomendado no @BotFather:

- `/setdescription` — "Alertas do bot de trading BTC/ETH"
- `/setuserpic` — upload de uma imagem qualquer
- `/setprivacy` — `Enable` (privacidade ativada; na Fase 2, quando virar
  bidirecional, isso garante que o bot só veja mensagens direcionadas)

---

## 2. Descobrir seu chat_id (1 min)

O bot só envia mensagens pra quem está na lista branca. Você precisa do seu
`chat_id` numérico.

1. No Telegram, procure por **@userinfobot**.
2. Mande qualquer coisa (ex.: `/start`).
3. Ele responde com seus dados. O campo **Id** é o seu `chat_id`, algo como
   `123456789`.

Se quiser adicionar mais alguém (casal, sócio), peça pra essa pessoa fazer
o mesmo e adicione o chat_id dela separado por vírgula.

---

## 3. Inicializar o chat com o bot (30 s)

O Telegram não deixa um bot mandar a primeira mensagem pra você — você
precisa falar com ele primeiro.

1. Abra o chat do bot que você criou (o username `@seu_bot`).
2. Clique em **Start** ou mande `/start`.
3. Pronto. Agora o bot pode te mandar mensagens.

(Se pular esse passo, o bot vai logar "chat not found" nos primeiros envios.)

---

## 4. Preencher o `.env`

Edite o `.env` na raiz do projeto e preencha:

```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQrsTUVwxyz-0123456789
TELEGRAM_ALLOWED_CHAT_IDS=123456789
```

Se tiver mais de um destinatário:

```env
TELEGRAM_ALLOWED_CHAT_IDS=123456789,987654321
```

Nunca comite o `.env` — ele já está no `.gitignore`.

---

## 5. Instalar a dependência

A biblioteca `node-telegram-bot-api` foi adicionada ao `package.json`.
Rode na raiz do projeto:

```bash
npm install
```

Isso atualiza o `package-lock.json` e baixa a lib no `node_modules/`.

Se o projeto roda em Docker:

```bash
npm run docker:up
```

(Rebuilda a imagem já com a lib nova. O `docker-compose` vai ver o
`package.json` modificado e reinstalar deps.)

---

## 6. Testar isoladamente

Antes de subir o stack inteiro, valide que o notifier fala com o Telegram:

```bash
node src/bot/notifier.js
```

Esse self-test manda 3 mensagens (info / signal de exemplo / trade aberto
de exemplo). Se chegou tudo no seu chat, está funcionando.

Se não chegar nada, o script imprime o que está faltando:

```
TELEGRAM_ENABLED    = false   ← você esqueceu de setar true?
TELEGRAM_BOT_TOKEN  set = false
TELEGRAM_ALLOWED_CHAT_IDS = []
```

Erros comuns e o que significam:

- **`401 Unauthorized`** — token errado. Copie de novo do @BotFather.
- **`400 chat not found`** — você não iniciou conversa com o bot, ou o
  chat_id tá errado. Refaça o passo 3.
- **`429 Too Many Requests`** — Telegram rate-limit. Aguarde ~1 min.

---

## 7. Subir o bot com alertas ativos

```bash
# Local
node scripts/start.js

# Docker
npm run docker:up
npm run docker:logs
```

Assim que o scanner e o monitor subirem, você recebe dois pings
`🟢 Scanner (PAPER) subiu …` e `🟢 Monitor (PAPER) subiu …`.

A partir daí, qualquer sinal / trade / TP / SL vira mensagem no celular.

---

## 8. Ajustes finos

### Silenciar sem perder histórico

No próprio chat com o bot, toque no nome → **Mute** → escolha a duração.
O bot continua mandando, mas você para de receber notificação. Volta a
notificar sozinho depois do período.

### Desligar completamente

No `.env`:

```env
TELEGRAM_ENABLED=false
```

Reinicie o stack. Nenhum código muda — as funções `notify.*` viram
no-op silenciosa, zero overhead.

### Várias pessoas / vários dispositivos

Adicione todos os `chat_id` separados por vírgula em
`TELEGRAM_ALLOWED_CHAT_IDS`. Cada um recebe todas as mensagens.

Importante: essa mesma lista, na **Fase 2**, vira a whitelist de quem
pode mandar comandos (`/panic`, `/status`, `/approve`, etc.). Já começa
planejando quem entra aí — se alguém não estiver na lista, as mensagens
dessa pessoa são ignoradas pelo bot.

---

## 9. O que vem depois (Fase 2 — não implementado ainda)

Quando você quiser fazer o bot **receber** comandos (não só alertar):

- `/status` — capital atual, posições abertas, P&L do dia
- `/positions` — lista trades abertos com P&L unrealized
- `/panic` — para o scanner, cancela ordens pendentes, fecha tudo a mercado
- `/approve <id>` / `/reject <id>` — aprovar/rejeitar sinal pendente
- `/resume` — religar scanner depois de um `/panic`

Nessa fase o notifier muda pra `polling: true` e o `src/bot/notifier.js`
vira um `src/bot/telegram.js` com command router. É outra conversa —
primeiro rodamos a Fase 1 em produção uns dias pra ter certeza que o
canal é confiável.

---

## Troubleshooting rápido

| Sintoma | Causa provável | Fix |
|---|---|---|
| Nada chega no celular | `TELEGRAM_ENABLED=false` ou vars vazias | Revisar `.env`, reiniciar o stack |
| `[notifier] Telegram desligado` no log | `TELEGRAM_ENABLED` ≠ `true` | Setar `true` e restart |
| `[notifier] TELEGRAM_ENABLED=true mas ... vazio` | Faltou token ou chat_id | Preencher as três vars |
| `sendMessage falhou ... 401` | Token errado/revogado | Pegar token novo no @BotFather |
| `sendMessage falhou ... 400 chat not found` | Nunca iniciou chat com o bot | Abrir chat do bot e mandar `/start` |
| Só chega a 1ª mensagem, depois nada | Rate-limit ou bot bloqueado | Verificar que você não bloqueou/deletou o bot |

---

**Segurança:**

- O token do bot é suficiente pra alguém **enviar mensagens em seu nome**
  (como se fosse o bot). Se vazar, revogue imediatamente no @BotFather
  com `/revoke`. Não é credencial de saque nem de trade — só de chat.
- A whitelist `TELEGRAM_ALLOWED_CHAT_IDS` é a defesa real. Sem chat_id
  autorizado, o bot não responde a ninguém, mesmo que alguém descubra
  o username.
- Na Fase 1 (read-only, `polling: false`), o risco é essencialmente zero:
  o bot nem escuta mensagens entrando.
