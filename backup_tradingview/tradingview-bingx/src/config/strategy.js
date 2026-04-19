// ─────────────────────────────────────────────────────────────────
//  Strategy Parameters
//  All trading logic constants live here. Edit to tune the strategy.
// ─────────────────────────────────────────────────────────────────

export const STRATEGY = {
  // ── Assets (BingX USDT-M Perpetual Futures symbols) ───────────
  // These are the symbols used for order execution on BingX.
  // For TradingView chart analysis, see SYMBOL_TV_MAP below.
  SYMBOLS: ["BTCUSDT", "ETHUSDT", "XAUUSDT"],

  // ── TradingView Symbol Map ─────────────────────────────────────
  // Maps each BingX symbol to its TradingView chart symbol.
  // Gold: TradingView uses "XAUUSD" (universal across brokers)
  SYMBOL_TV_MAP: {
    BTCUSDT: "BTCUSDT", // same on both
    ETHUSDT: "ETHUSDT", // same on both
    XAUUSDT: "XAUUSD",  // Gold: standard TradingView symbol
  },

  // ── Per-Symbol Config ──────────────────────────────────────────
  SYMBOL_CONFIG: {
    BTCUSDT: { enabled: true },
    ETHUSDT: { enabled: true },
    XAUUSDT: { enabled: true },
  },

  // ── Per-Symbol SL Override ─────────────────────────────────────
  // Gold moves 0.3-1%/day → 1.5% SL is appropriate.
  // If a symbol is not listed here, STRATEGY.SL_PCT is used.
  SYMBOL_SL_PCT: {
    BTCUSDT: 0.01,  // 1%   — high liquidity crypto
    ETHUSDT: 0.012, // 1.2% — slightly more volatile than BTC
    XAUUSDT: 0.015, // 1.5% — Gold: moderate volatility
  },

  // ── Per-Symbol Leverage Caps ───────────────────────────────────
  // Gold max 10x (more predictable, geopolitical spikes).
  SYMBOL_MAX_LEVERAGE: {
    BTCUSDT: 30, // Setup 2 can use 30x on BTC
    ETHUSDT: 10,
    XAUUSDT: 10, // Gold: capped at 10x
  },

  // ── Signal Expiry ──────────────────────────────────────────────
  // Pending signals are checked every 30s; expired ones are removed
  // so stale setups never get executed accidentally.
  //
  // Conditions that expire a signal:
  //   1. Age > MAX_AGE_HOURS  (market conditions changed)
  //   2. Price already crossed SL  (entering would be an instant loss)
  //   3. Price moved ENTRY_MISS_PCT past entry[0]  (LIMIT orders can't fill;
  //      opportunity has passed — a new scan will generate a fresh signal)
  SIGNAL_EXPIRY: {
    MAX_AGE_HOURS:  4,    // 1 scanner cycle; a new scan will supersede this signal
    ENTRY_MISS_PCT: 0.02, // 2% past first entry → setup conditions are stale
  },

  // ── Scale-In Entries ───────────────────────────────────────────
  // Instead of one market order, split the position into N LIMIT orders
  // at progressively better prices. SL is placed at SL_PCT below/above
  // the LAST (worst) entry. TPs are calculated from the average entry price.
  //
  // Example (LONG, 3 entries, 0.4% spacing, BTC @ $75,000):
  //   Entry 1: $75,000   (limit order at signal price)
  //   Entry 2: $74,700   (0.4% lower — better avg if fills)
  //   Entry 3: $74,400   (0.8% lower — best avg if fills)
  //   Avg entry: $74,700
  //   SL: $74,400 × 0.99 = $73,656 (1% below last entry)
  //   TPs: calculated from avg $74,700
  SCALE_IN: {
    ENABLED:     true,
    ENTRIES:     3,      // number of limit orders
    SPACING_PCT: 0.004,  // 0.4% price improvement between each entry
  },

  // ── Risk ───────────────────────────────────────────────────────
  SL_PCT: 0.01, // 1% default stop loss distance (below LAST scale entry)

  // Minimum confidence score (0–100) for any setup to generate a signal
  MIN_SCORE: 60,

  // Maximum open positions at once
  MAX_POSITIONS: 5,

  // Capital allocated per trade slot (as fraction of total capital).
  // 20% means you can have up to 5 simultaneous trades.
  CAPITAL_ALLOCATION_PCT: 0.20,

  // ── Fibonacci Take-Profit Levels (in R multiples) ───────────────
  FIB_LEVELS: {
    TP1: 2.0, // close 40% at 2R
    TP2: 4.0, // close 35% at 4R
    TP3: 6.0, // close 25% at 6R
  },

  // % of position to close at each TP level (must sum to 1.0)
  TP_DISTRIBUTION: {
    TP1: 0.40,
    TP2: 0.35,
    TP3: 0.25,
  },

  // ── Technical Analysis Thresholds ─────────────────────────────
  RSI: {
    OVERBOUGHT: 70,
    OVERSOLD: 30,
    NEUTRAL_HIGH: 60,
    NEUTRAL_LOW: 40,
  },

  ORDERBOOK: {
    BULL_IMBALANCE: 0.55,
    BEAR_IMBALANCE: 0.45,
    DEPTH_LEVELS: 20,
  },

  FUNDING: {
    BEARISH_THRESHOLD: 0.0001,   // > +0.01% = bearish
    BULLISH_THRESHOLD: -0.0001,  // < -0.01% = bullish
  },

  FEAR_GREED: {
    EXTREME_FEAR_MAX: 25,
    FEAR_MAX: 45,
    GREED_MIN: 55,
    EXTREME_GREED_MIN: 75,
  },

  TIMEFRAMES: {
    ENTRY_ANALYSIS: "D",
    TREND_FILTER: "W",
  },

  // ── Legacy Scoring Weights (kept for reference) ─────────────────
  // Not used by the new setup-based engine — see SETUPS below.
  SCORING_WEIGHTS: {
    EMA200_DAILY: 15,
    EMA21_WEEKLY: 10,
    MACD_WEEKLY: 10,
    RSI_WEEKLY: 5,
    FUNDING_RATE: 15,
    ORDERBOOK: 10,
    LONG_SHORT_RATIO: 10,
    FEAR_GREED: 10,
    MACRO_CONTEXT: 15,
  },
};

// ── Named Trading Setups ───────────────────────────────────────────
// Each setup has its own trigger logic, leverage, and SL distance.
// The signal engine evaluates all setups independently and returns
// a rationale[] array explaining exactly why each trade was entered.
//
// filterOnly: true  → used as confirmation filter for other setups
//                     (can also generate standalone signals if strong enough)
// symbols: string[] → restrict to specific symbols (BTC-only for setups 2 & 5)

export const SETUPS = {

  // ── Setup 1 ─ Trendline Breakout + Retest ────────────────────────
  // Detects LTB (downtrend line) or LTA (uptrend line) breakout,
  // followed by a retest of the broken line + reversal candle.
  // Uses swing high/low detection on daily OHLCV bars.
  TRENDLINE_BREAKOUT: {
    id: "TRENDLINE_BREAKOUT",
    name: "Setup 1 — Rompimento de LTB/LTA",
    description:
      "Rompimento de linha de tendência (LTB/LTA) + S/R horizontal + reteste + confirmação de reversão",
    leverage: 3,
    sl_pct: 0.015,     // 1.5% — wider to accommodate retest volatility
    tp_r: { tp1: 2.0, tp2: 3.5, tp3: 5.5 }, // R multiples
    enabled: true,
    symbols: ["BTCUSDT", "ETHUSDT"],
  },

  // ── Setup 2 ─ STH Realized Price Touch ───────────────────────────
  // When BTC touches the Short-Term Holder Realized Price (yellow line
  // on bitcoinmagazinepro.com), it acts as strong S/R.
  // High leverage entry with SL just below/above the line.
  STH_REALIZED_PRICE: {
    id: "STH_REALIZED_PRICE",
    name: "Setup 2 — STH Realized Price Touch",
    description:
      "BTC toca STH Realized Price (linha amarela) → entrada 30x leverage, SL no rompimento da linha",
    leverage: 30,
    sl_pct: 0.025,     // 2.5% — SL at line break; wider because 30x = 75% capital loss at break
    tp_r: { tp1: 1.5, tp2: 2.5, tp3: 4.0 }, // tighter TPs at high leverage
    enabled: true,
    symbols: ["BTCUSDT"],
    // Trigger: price within ±1.5% of STH Realized Price
    touch_pct: 0.015,
  },

  // ── Setup 3 ─ RSI + StochRSI + MACD Triple Alignment (Weekly) ────
  // All three momentum indicators must align on the weekly timeframe:
  // RSI crosses a key level + StochRSI crosses up/down + MACD changes color.
  RSI_STOCH_MACD: {
    id: "RSI_STOCH_MACD",
    name: "Setup 3 — Triple Confluência RSI + StochRSI + MACD (Semanal)",
    description:
      "RSI cruza zona + StochRSI cruza + MACD muda cor no semanal = forte sinal direcional",
    leverage: 5,
    sl_pct: 0.02,
    tp_r: { tp1: 2.0, tp2: 4.0, tp3: 6.5 },
    enabled: true,
    symbols: ["BTCUSDT", "ETHUSDT"],
  },

  // ── Setup 4 ─ Open Interest Confirmation Filter ───────────────────
  // OI increasing = current trend strengthens (confirms entry).
  // OI decreasing = trend weakening (filters out or reduces confidence).
  // This is primarily a filter applied to other setups; when combined
  // with a clear price trend it can also trigger a standalone signal.
  OI_CONFIRMATION: {
    id: "OI_CONFIRMATION",
    name: "Setup 4 — Open Interest como Filtro",
    description:
      "OI subindo = tendência fortalece (confirma setup); OI caindo = tendência enfraquece (cancela setup)",
    leverage: 3,
    sl_pct: 0.015,
    tp_r: { tp1: 2.0, tp2: 4.0, tp3: 6.0 },
    enabled: true,
    symbols: ["BTCUSDT", "ETHUSDT"],
    filterOnly: true,       // primarily a filter; affects confidence of other setups
    oi_change_threshold: 3, // % change in 24h to count as meaningful
  },

  // ── Setup 5 ─ Liquidation Zone Accumulation (24h) ────────────────
  // BTC/USDT Binance perpetuals liquidation map.
  // When a large cluster of liquidations accumulates in one zone AFTER
  // the opposite zone was cleared → market tends to push toward the
  // accumulated cluster to trigger cascade liquidations.
  LIQUIDATION_ZONE: {
    id: "LIQUIDATION_ZONE",
    name: "Setup 5 — Mapa de Liquidações BTC (24h)",
    description:
      "Acúmulo alto em zona após limpar liquidações opostas → sinal de liquidação em cascata",
    leverage: 5,
    sl_pct: 0.02,
    tp_r: { tp1: 2.0, tp2: 3.5, tp3: 5.5 },
    enabled: true,
    symbols: ["BTCUSDT"],
    // Trigger: one side must have >65% of nearby liquidations
    zone_dominance_threshold: 0.65,
  },
};

export default STRATEGY;
