# tradingview-bingx — Claude Instructions

Semi-automated trading system for BTC and ETH on BingX USDC-M Perpetual Futures.
Capital: ~$1100 USDC | Risk: 1% of total / 20% per slot | TPs: Fibonacci distribution | No leverage (1x).
Todos os trades são liquidados em USDC. Saques são manuais (sem auto-withdraw): a key da BingX só tem permissão Futures Read + Trade.

## Architecture

```
Binance Spot REST (OHLCV público) ─┐
BingX REST (preços/orderbook)     ─┤
CoinGlass (funding/OI/fear-greed) ─┘
       ↓
src/analysis/technical.js   ← EMA200/D, EMA21/W, MACD/W, RSI/W (calc local)
src/analysis/orderbook.js   ← BingX order book imbalance
src/analysis/onchain.js     ← CoinGlass: funding rate, OI, long/short ratio
src/analysis/macro.js       ← rules.json context + fear/greed index
       ↓
src/strategy/signals.js     ← scoring engine (0–100)
src/strategy/risk.js        ← position size, SL, TP1/TP2/TP3
src/strategy/fibonacci.js   ← fib levels from swing high/low
       ↓
src/storage/trades.js       ← SQLite: signals, trades, positions
src/bot/scanner.js          ← cron: every 4h scan BTC+ETH
src/bot/executor.js         ← places orders on BingX (after manual approval)
src/bot/monitor.js          ← watches open positions for SL/TP
       ↓
src/api/server.js           ← Express REST :3001
dashboard/                  ← React + Tailwind :3000
```

## Common Tasks

### "Analisar BTC agora"
Rode `analyzeTechnical()` diretamente — ele puxa OHLCV da Binance Spot REST
e calcula todos os indicadores localmente:

```bash
node -e "import('./src/analysis/technical.js').then(m => m.analyzeTechnical('BTCUSDC', m.createBinanceAdapter()).then(r => console.log(JSON.stringify(r, null, 2))))"
```

Retorna `{ symbol, price, daily:{ema200,rsi,…}, weekly:{ema21,macd,rsi,stochRsi,…}, entry:{…}, orderbook:{imbalance,…}, funding:{rate,bias} }`.

### "Gerar sinal de trade"
```bash
node src/strategy/signals.js
```
Retorna JSON com: `{ symbol, direction, score, entry, sl, tp1, tp2, tp3, breakdown }`

### "Rodar scan completo"
```bash
node src/bot/scanner.js --once
```
Analisa BTC e ETH, persiste sinais no SQLite, exibe tabela no terminal.

### "Ver trades e P&L"
```bash
node src/api/server.js
# Depois abrir http://localhost:3000 (dashboard)
```

### "Iniciar todos os serviços"
```bash
node scripts/start.js   # inicia API + scanner + monitor + dashboard em background
node scripts/stop.js    # para tudo
```

### "Aprovar sinal e executar"
1. Abre dashboard em http://localhost:3000
2. Vê o painel "Sinais Pendentes"
3. Clica APROVAR → executor.js coloca a ordem na BingX

### "Verificar posições abertas"
```bash
node src/bot/monitor.js --status
```

## Parâmetros de Estratégia

Editar `src/config/strategy.js`:
- `SL_PCT` — stop loss % (padrão: 0.01 = 1%)
- `CAPITAL_ALLOCATION_PCT` — % do capital por slot de trade (padrão: 0.20 = 20%, permite 5 simultâneos)
- `SCORING_WEIGHTS` — pesos de cada análise no score
- `FIB_LEVELS` — níveis fibonacci para TP
- `TP_DISTRIBUTION` — % da posição fechada em cada TP
- `MIN_SCORE` — score mínimo para gerar sinal (padrão: 65)

## Atualizar Contexto Macro

Editar `rules.json` (na raiz do projeto):
- `market_context_*` → eventos geopolíticos, macro drivers
- `risk_rules` → regras de risco da sessão
- `bias_criteria` → critérios de viés

Ou executar automaticamente:
```bash
node scripts/update-rules.js
```

## Fonte de dados de mercado

Indicadores técnicos são computados em `src/analysis/technical.js` a partir de
OHLCV público da Binance Spot REST (`api.binance.com`). Preços de execução,
orderbook e funding rate vêm da BingX REST. On-chain vem da CoinGlass. Sem
dependência de cliente desktop ou bridge CDP.

## Modo Paper Trading

Variável `PAPER_TRADE=true` no `.env` (padrão) — executor.js loga as ordens sem enviar à BingX.
Mudar para `PAPER_TRADE=false` somente após:
1. Ter as API keys BingX configuradas
2. Ter validado a estratégia em paper trading por pelo menos 2 semanas

## Tabelas SQLite (data/trades.db)

```sql
signals   — id, symbol, direction, score, entry, sl, tp1, tp2, tp3, created_at, status
trades    — id, signal_id, symbol, direction, entry_price, size, sl, tp1, tp2, tp3, opened_at, closed_at, pnl, status
positions — id, trade_id, symbol, side, size, entry_price, current_price, unrealized_pnl, updated_at
snapshots — id, capital, total_pnl, date (daily equity snapshots)
```

## APIs Externas Usadas

| API | Endpoint base | Dado |
|-----|--------------|------|
| BingX REST | `https://open-api.bingx.com` | Order book, preço, ordens, posições |
| CoinGlass | `https://open-api.coinglass.com/public/v2` | Funding rate, OI, long/short ratio |
| CoinGlass (public) | `https://open-api.coinglass.com` | Fear & Greed index |

## Regras de Segurança

1. **PAPER_TRADE=true** sempre que testar novo código
2. **Nunca commitar .env** — contém API keys
3. **Permissões BingX**: apenas Futures Read + Trade, NUNCA Withdraw
4. **Máximo 5 posições abertas** simultaneamente (20% do capital cada)
5. **Parar o bot** em eventos macro de alto impacto (FOMC, CPI) — ver rules.json
