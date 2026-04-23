# claudecode-trade — Claude Instructions

Semi-automated trading system for BTC and ETH on BingX USDT-M Perpetual Futures.
Capital: $1100 USDT | Risk: 1% of total / 20% per slot | TPs: Fibonacci distribution | No leverage (1x).

## Architecture

```
TradingView Desktop (CDP :9222)
       ↓ tv-mcp/src/core/ (local CDP bridge)
src/analysis/technical.js   ← EMA200/D, EMA21/W, MACD/W, RSI/W
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
Use TradingView MCP tools directly:
1. `chart_set_symbol` with `symbol: "BTCUSDT"` → muda para BTC
2. `chart_set_timeframe` with `timeframe: "D"` → timeframe diário
3. `data_get_study_values` → lê EMA200, EMA21, MACD, RSI
4. `quote_get` → preço atual
5. `chart_set_timeframe` with `timeframe: "W"` → muda para semanal
6. `data_get_study_values` → lê indicadores no semanal
7. `capture_screenshot` → captura visual

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

## TradingView CDP Bridge

Os arquivos de integração com o TradingView Desktop estão em `tv-mcp/src/`:
- `tv-mcp/src/connection.js` — conexão CDP
- `tv-mcp/src/core/` — funções de chart, data, health

Para iniciar TradingView com CDP habilitado:
```
scripts\launch_tv_debug.bat
```

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
