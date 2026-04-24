---
name: trade-executor
description: Executa um sinal aprovado na BingX em USDC-M Perpetual Futures — coloca ordem de entrada, SL, TPs (TP1/TP2/TP3) e aciona auto-withdraw USDC Perpetual → Fund → BASE quando um trade fecha com lucro. Use quando o usuário pedir "execute o sinal", "aprove o trade X", "force fechamento da posição Y", "envie o lucro para minha wallet" ou quando o dashboard disparar aprovação. NÃO decide se o trade deve rolar — isso é papel de risk-management e setup-detector.
---

# trade-executor

Recebe um sinal já aprovado (símbolo + direção + size + SL + TPs) e:

1. Ajusta leverage na BingX (USDC-M Perpetual)
2. Coloca ordem market de entrada
3. Coloca SL + 3 TPs como ordens bracket reduce-only
4. Persiste tudo em `data/trades.db`
5. Monitor.js depois watcha P&L e fecha

**E quando um trade fecha 100% no verde**, executa o fluxo de
auto-withdraw (USDC Perpetual → Fund/Main → saque BASE).

Todos os trades são liquidados em USDC — não há mais swap USDT→USDC.

## Quando usar

- Usuário clicou "APROVAR" no dashboard
- Usuário digitou "executa o sinal X"
- Trade monitor detectou que a posição foi totalmente fechada com lucro
  e precisa disparar o withdraw

## Chamada típica (executar sinal)

```js
import { executeSignal } from './src/bot/executor.js';

const result = await executeSignal(signalId, { approvedBy: "user" });
// result: { trade_id, entry_price, size, sl_price, tps: [tp1, tp2, tp3], order_ids: [] }
```

## Auto-withdraw — fluxo completo

Quando `monitor.js` detecta que uma posição USDC-M fechou (último lote) com P&L > 0:

```js
import { onTradeClosedWithProfit } from './src/exchanges/withdraw.js';

// Campo se chama pnl_usdt por compatibilidade de nome, mas o valor é USDC.
await onTradeClosedWithProfit({ symbol, pnl_usdt: 2.17 });
```

Ordem de operações (internamente em `withdraw.js`):

1. **Transfer PERP → FUND** — move USDC da carteira Perpetual para a carteira
   Fund/Main (withdrawals só podem sair do Fund)
2. **Withdraw USDC → BASE** — envia USDC direto para `WITHDRAW_WALLET_ADDRESS`
   na rede `WITHDRAW_NETWORK` (default BASE)

## Configuração (.env)

```
# Trade key (Futures Read + Trade)
BINGX_API_KEY=...
BINGX_SECRET_KEY=...

# Withdraw key — SEPARADA da trade key (Withdraw + Internal Transfer)
BINGX_WITHDRAW_API_KEY=...
BINGX_WITHDRAW_SECRET_KEY=...

AUTO_WITHDRAW_ENABLED=true           # master switch
WITHDRAW_WALLET_ADDRESS=0xD211b268fc17556C0cF8540938CE5C61f0E18E90
WITHDRAW_NETWORK=BASE
WITHDRAW_MIN_USDC=10                 # valor mínimo de USDC para disparar saque
WITHDRAW_DRY_RUN=true                # true = só loga, não envia
```

## Pré-requisitos na conta BingX

O projeto usa **duas API keys separadas** (princípio de menor privilégio):

1. **Trade key** (`BINGX_API_KEY` / `BINGX_SECRET_KEY`)
   - Permissões: Futures Read + Futures Trade (somente)
   - Usada pelo scanner/executor/monitor
   - **Não deve** ter permissão Withdraw
2. **Withdraw key** (`BINGX_WITHDRAW_API_KEY` / `BINGX_WITHDRAW_SECRET_KEY`)
   - Permissões: Withdraw + Internal Transfer (somente)
   - Usada **exclusivamente** por `src/exchanges/withdraw.js`
   - **Não deve** ter permissão Futures Trade
   - Fica em branco enquanto `AUTO_WITHDRAW_ENABLED=false`
3. **Endereço whitelisted**: adicionar `0xD211…8E90` na whitelist BingX
   para a rede `BASE` (BingX → Assets → Whitelist)
4. **2FA habilitado** na conta (requerido para withdraw via API)

Se a trade key vazar, o atacante não consegue sacar. Se a withdraw key
vazar, o atacante não consegue abrir posição. Vide `SETUP_BINGX.md`.

## Segurança

- Código começa com `WITHDRAW_DRY_RUN=true` — primeira execução só loga
- Nunca aciona withdraw se `AUTO_WITHDRAW_ENABLED=false`
- Nunca aciona withdraw se `PAPER_TRADE=true`
- Nunca aciona withdraw se P&L ≤ 0
- Saldo USDC acumulado só é sacado quando > `WITHDRAW_MIN_USDC`

## Checklist de aprovação manual

Antes de virar `WITHDRAW_DRY_RUN=false`:

1. ✅ Rodar em dry-run por pelo menos 3 trades fechados com lucro
2. ✅ Confirmar logs mostram valores corretos e endereço correto
3. ✅ Verificar na BingX que o whitelist está ativo para BASE
4. ✅ Fazer 1 withdraw manual primeiro (~$1 USDC) para validar rede/endereço
5. ✅ Só então: `WITHDRAW_DRY_RUN=false`
