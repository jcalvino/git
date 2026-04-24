---
name: technical-analysis
description: Lê indicadores técnicos (EMA, RSI, MACD, StochRSI, Fibonacci, orderbook, funding) para BTC/ETH/SOL e retorna veredito estruturado. Use quando o usuário pedir "analise BTC", "como está ETH agora", "leia indicadores", "qual o bias técnico", ou quando for preciso puxar dados de mercado antes de decidir sobre um trade. Indicadores são calculados localmente a partir de OHLCV da Binance Spot REST — sem dependência de cliente desktop. Não executa ordens nem calcula position size.
---

# technical-analysis

Lê o estado técnico de um ativo (15m/1h/4h/1D/1W) e devolve um objeto
estruturado. É o primeiro passo antes de `setup-detector` ou
`risk-management`.

## Quando usar

- Usuário pergunta "como está BTC agora?"
- Usuário pede "analise ETH no 1H"
- Outra skill pediu dados técnicos para combinar com on-chain/macro

## Como rodar

Preferencialmente use as funções já existentes no projeto:

```bash
node -e "import('./src/analysis/technical.js').then(m => m.analyzeTechnical('BTCUSDC', m.createBinanceAdapter()).then(r => console.log(JSON.stringify(r, null, 2))))"
```

`createBinanceAdapter()` monta um cliente REST-only que busca OHLCV público
em `api.binance.com`. Todos os indicadores (EMA, RSI, MACD, StochRSI) são
computados em JS puro no processo — nenhuma GUI, desktop app ou MCP externo
necessário.

## Schema de retorno

```json
{
  "symbol": "BTCUSDC",
  "price": 78213.1,
  "timestamp": "2026-04-23T10:00:00Z",
  "weekly":  { "ema9": …, "ema21": …, "ema50": …, "rsi": …, "macd": { "hist": …, "signal": … } },
  "daily":   { "ema200": …, "rsi": …, "bars": [ … ] },
  "entry":   { "ema21": …, "rsi": …, "macd": { … } },   // 15min
  "orderbook": { "imbalance": 0.57, "bid_depth": …, "ask_depth": … },
  "funding":   { "rate": 0.00012, "bias": "bearish" }
}
```

## Fontes de dados

| Dado | Origem |
|---|---|
| OHLCV (para EMA/RSI/MACD/StochRSI) | Binance Spot REST (`api.binance.com`) |
| Preço spot | `getPrice()` em `src/exchanges/bingx.js` |
| Orderbook | `getOrderBook()` em `src/exchanges/bingx.js` |
| Funding rate | `getFundingRate()` em `src/exchanges/bingx.js` |
| On-chain | `src/analysis/onchain.js` (CoinGlass) |

## Checklist antes de devolver resultado

1. ✅ Todos os campos numéricos são números (não strings, não null)
2. ✅ Timestamp em UTC
3. ✅ Se algum fetch falhou, campo vem como `null` (não quebra o caller)
4. ✅ Nunca retornar leitura de mais de 5 min atrás sem flag `stale: true`
