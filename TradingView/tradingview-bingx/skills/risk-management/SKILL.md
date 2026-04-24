---
name: risk-management
description: Calcula position size, stop-loss, take-profits (Fibonacci) e valida regras de risco (max positions, daily loss, capital mínimo, extreme fear multiplier) antes de qualquer ordem. Use quando o usuário pedir "calcule o tamanho da posição", "qual o SL", "quanto posso arriscar", "o bot pode abrir mais um trade?", ou quando for necessário validar um setup contra as regras antes de executar. Não lê mercado nem coloca ordens — só faz o cálculo e retorna decisão + razão.
---

# risk-management

Pega um sinal candidato (símbolo + direção + preço de entrada + setup config)
e devolve: position size, SL, TP1/TP2/TP3 e um boolean `approved` com a razão.
É quem decide se um trade pode nascer.

## Quando usar

- Depois que `setup-detector` encontrou um setup viável
- Usuário pergunta "posso arriscar mais hoje?" / "quanto colocar?"
- Verificar se o bot ultrapassaria limite diário ao abrir novo trade

## Regras que esta skill verifica

Lê de `src/config/strategy.js` (STRATEGY) e `src/config/index.js` (config):

| Regra | Fonte | Default |
|---|---|---|
| `DAILY_RISK_PCT` | strategy.js | 0.5% do capital |
| `MONTHLY_RISK_PCT` | strategy.js | 15% |
| `CAPITAL_ALLOCATION_PCT` | strategy.js | 20% do capital por slot |
| `MIN_FREE_CAPITAL_PCT` | strategy.js | 20% sempre livre |
| `SL_PCT` / `SYMBOL_SL_PCT[symbol]` | strategy.js | 0.5% / override por ativo |
| `FIB_LEVELS` (TP1/2/3 em R) | strategy.js | 1.5R / 2.618R / 4.236R |
| `TP_DISTRIBUTION` | strategy.js | 50 / 30 / 20 |
| Max posições abertas | rules.json → `risk_rules[]` | 2 |
| Fear & Greed <20 → cut size 50% | rules.json → `risk_rules[]` | sim |
| FOMC / CPI blackout | rules.json → `risk_rules[]` | sim |

## Como rodar

A lógica já está em `src/strategy/risk.js`. Chamada típica:

```js
import { calculatePositionSize, validateRiskRules } from './src/strategy/risk.js';

const check = validateRiskRules({ symbol, direction, entry, setup });
if (!check.approved) return { approved: false, reason: check.reason };

const sizing = calculatePositionSize({ symbol, entry, sl_pct: setup.sl_pct });
// sizing: { size, value_usdt, sl, tp1, tp2, tp3, leverage }
// Nota: campo chama-se value_usdt/risk_usdt por compat, mas os valores
// são em USDC (todos os trades são USDC-M).
```

## Schema de retorno

```json
{
  "approved": true,
  "reason": "OK",
  "size": 0.0011,
  "value_usdt": 86.5,
  "leverage": 3,
  "sl": 77820.5,
  "tp": { "tp1": 79025.0, "tp2": 80110.3, "tp3": 82201.7 },
  "risk_usdt": 0.64,
  "risk_pct": 0.005,
  "notes": []
}
```

## Checklist

1. ✅ Rejeitar se `capital_livre < MIN_FREE_CAPITAL_PCT × capital_total`
2. ✅ Rejeitar se `loss_do_dia + novo_risco > DAILY_RISK_PCT × capital`
3. ✅ Rejeitar se posições abertas ≥ max (default 2 via `rules.json`)
4. ✅ Aplicar multiplier de Fear & Greed se < 20
5. ✅ Reduzir sizing para 0 durante janela FOMC ± 4h se configurada
6. ✅ Arredondar `size` para o stepSize aceito pela BingX (ver `lotSizeFilter`)
