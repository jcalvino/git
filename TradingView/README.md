# TradingView BingX — AI-Powered Semi-Automated Trading System

> **⚠️ DISCLAIMER — READ BEFORE USING**
>
> This project is **strictly for educational and AI research purposes**. It was built to study how artificial intelligence can assist in financial market analysis — not as a financial advisory tool.
>
> **This is NOT financial advice.** Trading cryptocurrencies and derivatives involves substantial risk of loss. Past performance does not guarantee future results. Leverage amplifies both gains and losses — you can lose more than your initial investment.
>
> **Always do your own research (DYOR).** Before making any investment decision, consult a licensed financial advisor. The trading rules, setups, and parameters described here **may not be suitable for your situation** and **can and should be changed** to fit your own risk tolerance, capital, and market experience.
>
> The author assumes no responsibility for any financial losses incurred from the use of this software.

---

## What This Project Is

A semi-automated trading system for **BTC, ETH, and other crypto/commodity markets** on BingX USDT-M Perpetual Futures. The system uses AI-driven analysis to generate trade signals, but **requires manual approval before any order is placed** — a human is always in the loop.

The project was developed as an AI study to explore:
- How large language models can integrate with real-time market data
- Whether systematic, rule-based signal generation can improve trading consistency
- How to build observable, explainable AI decision-making in a financial context

---

## Architecture

```
TradingView Desktop (CDP :9222)
       ↓ tv-mcp/ (local CDP bridge)
src/analysis/technical.js   ← EMA200/D, EMA21/W, MACD, RSI (via TradingView)
src/analysis/orderbook.js   ← BingX order book imbalance
src/analysis/onchain.js     ← CoinGlass: funding rate, OI, long/short ratio
src/analysis/macro.js       ← rules.json context + Fear & Greed index
       ↓
src/strategy/signals.js     ← 5-setup scoring engine (0–100)
src/strategy/risk.js        ← position size, SL, TP1/TP2/TP3 (Fibonacci)
       ↓
src/storage/trades.js       ← SQLite: signals, trades, positions
src/bot/scanner.js          ← cron scan (every 4h by default)
src/bot/monitor.js          ← watches open positions for SL/TP hits
       ↓
src/api/server.js           ← Express REST API :3001
dashboard/                  ← React + Tailwind dashboard :3000
```

---

## Trading Strategy (AI-Generated Signals)

> **⚠️ These rules were designed for a specific market environment and risk profile. They may not be appropriate for you. Change them freely in `src/config/strategy.js`.**

The system uses **5 named setups** to evaluate trade opportunities:

### Setup 1 — EMA Pullback Continuation (15min + 1H)
Enters when price pulls back to the EMA21 on 15min within a confirmed 1H trend (EMA9 > EMA21 > EMA50 stack). A reversal candle at the pullback confirms the entry.

### Setup 2 — STH Realized Price SHORT (BTC only)
When BTC price approaches the Short-Term Holder Realized Price line, the system generates a SHORT signal. Uses higher leverage (20x) with a wide 10% SL — sized so that dollar risk stays at 1% of capital.

### Setup 3 — S/R Breakout + Retest (1H + 15min)
Identifies horizontal support/resistance zones from 1H swing highs/lows. Waits for a confirmed breakout (6+ of 10 bar closes on the new side), then enters on the retest of the flipped level with a reversal candle.

### Setup 4 — Open Interest Filter
Uses OI trend as a confirmation filter: rising OI strengthens the current trend (confirms other setups), falling OI signals weakening (filters them out).

### Setup 5 — Liquidation Zone Accumulation (BTC only)
Monitors the BTC/USDT liquidation heatmap. When one side accumulates >65% of nearby liquidations after the opposing side was cleared, the system signals a potential cascade liquidation move.

### Risk Parameters (defaults — change in `src/config/strategy.js`)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `SL_PCT` | 0.5% | Stop loss distance from entry |
| `CAPITAL_ALLOCATION_PCT` | 20% | Max capital per trade slot |
| `MIN_FREE_CAPITAL_PCT` | 20% | Minimum capital always kept free |
| `DAILY_RISK_PCT` | 1% | Max daily loss before bot pauses |
| `MIN_SCORE` | 60 | Minimum signal confidence to alert |
| `FIB_LEVELS` | 1.618R / 2.618R / 4.236R | Take-profit levels (Fibonacci) |
| `TP_DISTRIBUTION` | 40% / 35% / 25% | Position closed at each TP |

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | ≥ 18.0 | [nodejs.org](https://nodejs.org) |
| **TradingView Desktop** | Latest | Required for CDP chart analysis |
| **BingX Account** | — | Futures trading enabled |
| **Git** | Any | For cloning the repo |

> **TradingView Desktop requirement**: The analysis engine connects to TradingView Desktop via Chrome DevTools Protocol (CDP) to read chart indicators in real time. The TradingView web version is **not** supported — you need the downloadable desktop app.

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME/tradingview-bingx
```

### 2. Install dependencies

```bash
# Backend (API + bot)
npm install

# Dashboard (React frontend)
npm install --prefix dashboard
```

### 3. Configure environment variables

```bash
# Copy the example file
cp .env.example .env
```

Open `.env` and fill in your values:

```env
# BingX API keys — generate at: BingX → Profile → API Management
# Required permissions: Futures Read + Futures Trade
# NEVER enable "Withdraw" permission
BINGX_API_KEY=your_api_key_here
BINGX_SECRET_KEY=your_secret_key_here

# Start in paper trade mode (no real orders) — recommended for testing
PAPER_TRADE=true

# Your total trading capital in USDT
CAPITAL_USDT=200

# Risk per trade (1% recommended for beginners)
MAX_RISK_PCT=0.01
```

### 4. Launch TradingView Desktop with CDP enabled

On Windows, run the batch script:

```bash
scripts\launch_tv_debug.bat
```

This launches TradingView with the debugging port open on `:9222` so the bot can read chart data.

### 5. Start the system

```bash
# Start everything (API + scanner + monitor + dashboard) as background services
npm start

# Or run individual components:
npm run api        # Express API on :3001
npm run bot        # Scanner (scans every 4h by default)
npm run monitor    # Position monitor
npm run dashboard  # React dashboard on :3000
```

### 6. Open the dashboard

```
http://localhost:3000
```

---

## Running in Paper Trade Mode (Recommended)

Set `PAPER_TRADE=true` in your `.env` file (this is the default). The system will:
- Analyze markets and generate signals normally
- Display signals in the dashboard for manual review
- **Log all orders without sending them to BingX**

This lets you validate the strategy, understand signal quality, and observe how the system behaves — all without risking real capital.

Switch to `PAPER_TRADE=false` only after you've:
1. Configured your BingX API keys
2. Tested the system in paper mode for at least 2 weeks
3. Understood the risks and verified the strategy works for your situation

---

## Available Commands

```bash
npm start              # Start all services in background
npm stop               # Stop all services
npm run restart        # Restart all services
npm run scan           # Run a single scan and exit
npm run update-rules   # Update market context in rules.json
npm run test:config    # Verify configuration is loaded correctly
npm run test:technical # Test TradingView data connection
npm run test:signals   # Test signal generation for all symbols
npm run test:bingx     # Test BingX API connection
```

---

## Project Structure

```
tradingview-bingx/
├── .env.example          ← copy to .env and fill in your keys
├── rules.json            ← market context (update manually or via update-rules)
├── src/
│   ├── config/
│   │   ├── index.js      ← loads and validates .env
│   │   └── strategy.js   ← ALL trading parameters (edit to tune strategy)
│   ├── analysis/         ← data fetching (TradingView, BingX, CoinGlass)
│   ├── strategy/         ← signal engine, Fibonacci TP, position sizing
│   ├── bot/              ← scanner, monitor, executor, SL/TP repair
│   ├── exchanges/        ← BingX REST + WebSocket client
│   ├── storage/          ← SQLite database (trades, signals, snapshots)
│   └── api/              ← Express REST API for the dashboard
├── dashboard/            ← React + Tailwind frontend
│   └── src/
│       ├── components/   ← Header, OpenPositions, TradeHistory, etc.
│       └── hooks/
│           └── useLiveData.js  ← polling and state management
├── scripts/
│   ├── start.js          ← spawns all services as background processes
│   ├── stop.js           ← kills all background services
│   └── restart.js        ← stop + start
└── tv-mcp/               ← TradingView CDP bridge
    └── src/
        ├── connection.js ← CDP connection manager
        └── core/         ← chart, data, health modules
```

---

## External APIs Used

| API | Data | Cost |
|-----|------|------|
| BingX REST | Order book, klines, funding rate, positions, orders | Free |
| BingX WebSocket | Real-time price, position updates | Free |
| CoinGlass (public) | Fear & Greed index, liquidation data | Free |
| TradingView Desktop | EMA, RSI, MACD, OHLCV (via CDP) | Requires TV account |

---

## Security Notes

- **Never commit `.env`** — it contains your API keys. It is already in `.gitignore`.
- **BingX API permissions**: only enable `Futures Read` + `Futures Trade`. **Never enable Withdraw.**
- The `data/` directory (SQLite database, logs, PID files) is excluded from git.
- Keep `PAPER_TRADE=true` whenever testing new code or strategy changes.

---

## Risk Warnings

Trading financial instruments, especially leveraged derivatives, carries significant risk:

- **You can lose all your invested capital.** With leverage, losses can exceed your deposit.
- **Past performance is not indicative of future results.** The setups described here performed in specific market conditions that may not repeat.
- **AI-generated signals are not guarantees.** The scoring system produces probabilities, not certainties. Every trade can lose.
- **Market conditions change.** Rules that work in trending markets fail in choppy markets. The `rules.json` and `strategy.js` files must be kept current.
- **Regulatory risk.** Cryptocurrency trading may be restricted or prohibited in your jurisdiction. Check local regulations before using this software.
- **Technical risk.** Software bugs, network failures, exchange outages, or API rate limits can cause missed entries, unexecuted stops, or duplicate orders.

---

## Contributing

Contributions, bug reports, and improvement ideas are welcome. Open an issue or submit a pull request.

---

## License

MIT — use freely, but at your own risk. See above disclaimers.

---

*This project was built as an AI research study. It demonstrates how LLMs can be integrated with real-time financial data for systematic analysis and decision support — not as a production trading system or financial product.*
