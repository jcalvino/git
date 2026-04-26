---
name: trade-executor
description: Executa um sinal aprovado na BingX em USDC-M Perpetual Futures — coloca ordem de entrada, SL, TPs (TP1/TP2/TP3) e persiste o trade no banco local. Use quando o usuário pedir "execute o sinal", "aprove o trade X", "force fechamento da posição Y" ou quando o dashboard disparar aprovação. NÃO decide se o trade deve rolar — isso é papel de risk-management e setup-detector. Saques de lucro são manuais (o bot não tem permissão de withdraw na BingX).
---

# trade-executor

Recebe um sinal já aprovado (símbolo + direção + size + SL + TPs) e:

1. Ajusta leverage na BingX (USDC-M Perpetual)
2. Coloca ordem market de entrada
3. Coloca SL + 3 TPs como ordens bracket reduce-only
4. Persiste tudo em `data/trades.db`
5. Monitor.js depois watcha P&L e fecha

Todos os trades são liquidados em USDC — não há swap USDT→USDC.

**Saques são manuais.** O bot não move USDC pra fora da BingX por
princípio de menor privilégio: a API key dele só tem permissão Futures
Read + Trade. Quando você quiser realizar lucro, vai no console BingX
manualmente.

## Quando usar

- Usuário clicou "APROVAR" no dashboard
- Usuário digitou "executa o sinal X"
- Trade monitor detectou que a posição foi totalmente fechada (registro
  no DB, sem ação de saque)

## Chamada típica (executar sinal)

```js
import { executeSignal } from './src/bot/executor.js';

const result = await executeSignal(signalId, { approvedBy: "user" });
// result: { trade_id, entry_price, size, sl_price, tps: [tp1, tp2, tp3], order_ids: [] }
```

## Configuração (.env)

```
# Trade key (Futures Read + Trade — sem Withdraw)
BINGX_API_KEY=...
BINGX_SECRET_KEY=...

PAPER_TRADE=true           # mantém true até validar a estratégia
CAPITAL_USDC=200           # valor inicial; refreshCapital atualiza em runtime
MAX_RISK_PCT=0.01          # 1% do capital por trade
```

## Pré-requisitos na conta BingX

O projeto usa **uma única API key** com escopo mínimo:

1. **Trade key** (`BINGX_API_KEY` / `BINGX_SECRET_KEY`)
   - Permissões: Futures Read + Futures Trade (somente)
   - Usada pelo scanner/executor/monitor
   - **Não tem** permissão Withdraw nem Internal Transfer
2. **2FA habilitado** na conta (boa prática geral)
3. **IP whitelist** na key (recomendado): só permite uso a partir do IP
   da máquina onde o bot roda

Se a trade key vazar, o atacante só pode abrir/fechar posições — não
pode sacar nada. O dano máximo fica contido no saldo da Perpetual.
Vide `SETUP_BINGX.md`.

## Segurança

- `PAPER_TRADE=true` é o padrão — primeiro trade real exige flip explícito
- A key da BingX não tem permissão Withdraw — não há vetor de saque pelo bot
- Saques de lucro são feitos manualmente no console BingX quando você decidir
