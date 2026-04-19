// ─────────────────────────────────────────────────────────────────
//  Strategy Parameters
//  All trading logic constants live here. Edit to tune the strategy.
// ─────────────────────────────────────────────────────────────────

export const STRATEGY = {
  // ── Assets (BingX USDT-M Perpetual Futures symbols) ───────────
  // These are the symbols used for order execution on BingX.
  // For TradingView chart analysis, see SYMBOL_TV_MAP below.
  SYMBOLS: [
    // Tier 1 — highest liquidity
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    // Tier 2 — established alts
    "ADAUSDT", "LINKUSDT", "NEARUSDT", "UNIUSDT", "AAVEUSDT",
    // Tier 3 — newer / higher volatility
    "TRXUSDT", "SUIUSDT", "ONDOUSDT", "ENAUSDT", "HYPEUSDT",
    // Commodities — high probability in current macro environment
    // Gold: safe-haven demand, de-dollarization, central bank buying (ATH bull run)
    // Silver: follows gold with lag; gold/silver ratio compression likely
    // WTI: geopolitical risk + tariff demand uncertainty → high volatility for day trading
    "XAUUSDT", "XAGUSDT", "WTIUSDT",
  ],

  // ── TradingView Symbol Map ─────────────────────────────────────
  // Maps each BingX symbol to its TradingView chart symbol.
  // Most symbols are identical; override only when they differ.
  SYMBOL_TV_MAP: {
    BTCUSDT:  "BTCUSDT",
    ETHUSDT:  "ETHUSDT",
    SOLUSDT:  "SOLUSDT",
    BNBUSDT:  "BNBUSDT",
    XRPUSDT:  "XRPUSDT",
    ADAUSDT:  "ADAUSDT",
    LINKUSDT: "LINKUSDT",
    NEARUSDT: "NEARUSDT",
    UNIUSDT:  "UNIUSDT",
    AAVEUSDT: "AAVEUSDT",
    TRXUSDT:  "TRXUSDT",
    SUIUSDT:  "SUIUSDT",
    ONDOUSDT: "ONDOUSDT",
    ENAUSDT:  "ENAUSDT",
    HYPEUSDT: "HYPEUSDT",
    XAUUSDT:  "XAUUSD",   // Gold: TradingView uses XAUUSD (no T)
    XAGUSDT:  "XAGUSD",   // Silver: TradingView XAGUSD
    WTIUSDT:  "USOIL",    // WTI Crude Oil: TradingView TVC:USOIL
  },

  // ── Per-Symbol Config ──────────────────────────────────────────
  SYMBOL_CONFIG: {
    BTCUSDT:  { enabled: true },
    ETHUSDT:  { enabled: true },
    SOLUSDT:  { enabled: true },
    BNBUSDT:  { enabled: true },
    XRPUSDT:  { enabled: true },
    ADAUSDT:  { enabled: true },
    LINKUSDT: { enabled: true },
    NEARUSDT: { enabled: true },
    UNIUSDT:  { enabled: true },
    AAVEUSDT: { enabled: true },
    TRXUSDT:  { enabled: true },
    SUIUSDT:  { enabled: true },
    ONDOUSDT: { enabled: true },
    ENAUSDT:  { enabled: true },
    HYPEUSDT: { enabled: true },
    XAUUSDT:  { enabled: true },
    XAGUSDT:  { enabled: true },
    WTIUSDT:  { enabled: true },
  },

  // ── Per-Symbol SL Distance (15-min Day Trading) ───────────────
  // Tighter than daily — 15min ATR is ~40-60% of daily ATR.
  // Each scale entry has its own individual SL at this distance.
  // If a symbol is not listed here, STRATEGY.SL_PCT (0.5%) is used.
  SYMBOL_SL_PCT: {
    // Tier 1
    BTCUSDT:  0.005, // 0.5% — deep liquidity, 15min ATR ~$300-500
    ETHUSDT:  0.006, // 0.6%
    SOLUSDT:  0.008, // 0.8% — higher beta, wider 15min candles
    BNBUSDT:  0.006, // 0.6%
    XRPUSDT:  0.008, // 0.8% — news spikes common
    // Tier 2
    ADAUSDT:  0.008, // 0.8%
    LINKUSDT: 0.008, // 0.8%
    NEARUSDT: 0.010, // 1.0% — smaller cap, wider spread
    UNIUSDT:  0.008, // 0.8%
    AAVEUSDT: 0.008, // 0.8%
    // Tier 3 — wider for high volatility
    TRXUSDT:  0.008, // 0.8%
    SUIUSDT:  0.010, // 1.0% — newer, erratic 15min candles
    ONDOUSDT: 0.012, // 1.2% — low cap, high spread
    ENAUSDT:  0.010, // 1.0%
    HYPEUSDT: 0.012, // 1.2% — newer token, thin book
    // Commodities — slightly wider SL due to external market sessions overlap
    XAUUSDT:  0.008, // 0.8% — Gold 15min moves
    XAGUSDT:  0.010, // 1.0% — Silver is more volatile than Gold
    WTIUSDT:  0.012, // 1.2% — Oil has wider 15min swings, news spikes common
  },

  // ── Per-Symbol Leverage Caps ───────────────────────────────────
  // Lower cap / newer assets get lower max leverage to limit exposure.
  SYMBOL_MAX_LEVERAGE: {
    // Tier 1
    BTCUSDT:  30,  // Setup 2 (STH) uses 30x on BTC
    ETHUSDT:  10,
    SOLUSDT:  20,
    BNBUSDT:  20,
    XRPUSDT:  20,
    // Tier 2
    ADAUSDT:  15,
    LINKUSDT: 15,
    NEARUSDT: 10,
    UNIUSDT:  10,
    AAVEUSDT: 10,
    // Tier 3
    TRXUSDT:  15,
    SUIUSDT:  10,
    ONDOUSDT:  5,
    ENAUSDT:  10,
    HYPEUSDT: 10,
    // Commodities — conservative leverage (external markets, less liquidity at night)
    XAUUSDT:  10,
    XAGUSDT:  10,
    WTIUSDT:   5, // Oil: lower cap — extreme intraday volatility possible
  },

  // ── Signal Expiry ──────────────────────────────────────────────
  // On 15-min timeframe signals go stale quickly — expire after 30 min.
  //
  // Conditions that expire a signal:
  //   1. Age > MAX_AGE_HOURS  (market conditions changed)
  //   2. Price already crossed SL  (entering would be an instant loss)
  //   3. Price moved ENTRY_MISS_PCT past entry[0]  (LIMIT orders can't fill;
  //      opportunity has passed — a new scan will generate a fresh signal)
  SIGNAL_EXPIRY: {
    MAX_AGE_HOURS:  0.5,  // 30 min — 15min signals go stale fast
    ENTRY_MISS_PCT: 0.01, // 1% past first entry → stale on 15min
  },

  // ── Scale-In Entries ───────────────────────────────────────────
  // Each entry has its own individual SL (1% capital risk per entry).
  //
  // Example (SHORT, 3 entries, 0.3% spacing, BTC @ $80,000):
  //   Entry 1: $80,000  MARKET → SL at $80,400 (0.5% above = 1% risk)
  //   Entry 2: $80,240  LIMIT  → SL at $80,641
  //   Entry 3: $80,480  LIMIT  → SL at $80,882
  //
  // ⚠ RISK NOTE: with 3 entries all filled, max loss = 3 × 1% = 3%
  //   if all stops hit simultaneously (e.g. gap on news).
  //   The daily 1% loss limit will halt trading after the first stop out.
  SCALE_IN: {
    ENABLED:     true,
    ENTRIES:     3,      // number of scale levels
    SPACING_PCT: 0.003,  // 0.3% price step between entries (15min range)
  },

  // ── Daily / Monthly Risk & Profit Limits ─────────────────────
  // Bot pauses trading for the rest of the day once realized losses
  // exceed DAILY_RISK_PCT × capital OR profit target is reached.
  DAILY_RISK_PCT:   0.01,   // 1% of capital — max loss per day
  MONTHLY_RISK_PCT: 0.30,   // 30% of capital — informational limit

  // Daily profit target — bot stops opening new trades when reached.
  // ⚠ MATH NOTE: $100/day on $128 capital = 78% daily ROI.
  //   With 1% risk per entry ($1.28), each trade at 2R makes ~$2.56.
  //   You would need 40 consecutive winning trades per day to hit $100.
  //   Suggested realistic target: $5-10/day (4-8%) until capital grows.
  DAILY_PROFIT_TARGET: 0,   // 0 = sem parada por lucro — opera o dia inteiro buscando o máximo
  DAILY_PROFIT_REFERENCE: 100, // meta de referência ($100/dia) — exibida no dashboard, não bloqueia trades

  // ── Risk ─────────────────────────────────────────────────────
  SL_PCT: 0.005, // 0.5% default SL distance on 15min timeframe

  // Minimum confidence score (0–100) for any setup to generate a signal
  MIN_SCORE: 60,

  // Capital reserve — always keep this fraction of total capital free.
  // Ensures the account is never fully deployed; new opportunities can
  // always be taken regardless of how many positions are currently open.
  // Example: $128 capital × 0.20 = $25.60 minimum always available.
  MIN_FREE_CAPITAL_PCT: 0.20,

  // Capital allocated per trade slot (as fraction of total capital).
  // This limits position value per individual entry — not trade count.
  CAPITAL_ALLOCATION_PCT: 0.20,

  // ── Fibonacci Take-Profit Levels (in R multiples) ──────────────
  // Fib extensions: 1.618R, 2.618R, 4.236R from entry → SL distance.
  // On 15min with 0.5% SL:
  //   TP1 @ 1.618R = +0.81% from entry
  //   TP2 @ 2.618R = +1.31% from entry
  //   TP3 @ 4.236R = +2.12% from entry
  FIB_LEVELS: {
    TP1: 1.618, // close 40% at 1.618R (Fib extension)
    TP2: 2.618, // close 35% at 2.618R
    TP3: 4.236, // close 25% at 4.236R
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

  // ── Timeframes ─────────────────────────────────────────────────
  // Switched to 15-min for day trading / scalping.
  // ENTRY_ANALYSIS = timeframe for EMA, RSI, MACD, OHLCV bars.
  // TREND_FILTER   = higher timeframe for trend confirmation.
  //                  Set equal to ENTRY_ANALYSIS to use only one TF.
  TIMEFRAMES: {
    ENTRY_ANALYSIS: "15",  // 15-minute bars for all indicators
    TREND_FILTER:   "60",  // 1-hour bars for trend direction filter
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

  // ── Setup 1 ─ EMA Pullback Continuation (15min + 1H) ─────────────
  // The single highest-probability day trading setup in trending markets.
  //
  // Logic:
  //   1. 1H EMA stack check: EMA9 > EMA21 > EMA50 (bullish) or inverse
  //   2. 15min: price pulls back to the EMA21 (within ema_touch_pct)
  //   3. 15min: reversal candle confirms the rejection
  //   4. 1H RSI not in extreme zone (>75 or <25) — guards against fade
  //   5. Weekly bias (RSI/MACD/StochRSI) as direction bonus/penalty
  //
  // Why it works: In trending markets, price always returns to the EMA21
  // before continuing the trend. This is where institutional orders sit.
  // The EMA stack on 1H acts as a trend quality filter — if the 3 EMAs
  // are misaligned, the trend is choppy and this setup stays silent.
  EMA_PULLBACK: {
    id: "EMA_PULLBACK",
    name: "Setup 1 — EMA Pullback na Tendência (15min + 1H)",
    description:
      "EMA9/21/50 stack no 1H define tendência; toque no EMA21 no 15min + vela de reversão = entrada",
    leverage: 5,
    sl_pct: 0.005,     // uses SYMBOL_SL_PCT override per asset
    tp_r: { tp1: 1.618, tp2: 2.618, tp3: 4.236 }, // Fibonacci R multiples
    enabled: true,
    symbols: null,     // null = all symbols
    ema_touch_pct: 0.008, // 0.8% from EMA21 counts as "touching zone"
  },

  // ── Setup 2 ─ STH Realized Price SHORT (Isolated Rule) ──────────
  // When BTC price approaches the Short-Term Holder Realized Price
  // (yellow line on bitcoinmagazinepro.com), open a SHORT.
  //
  // This is an ISOLATED setup — it ignores the general trend, score
  // minimum, and leverage caps. It fires ONLY as SHORT on BTCUSDT.
  //
  // ⚠ RISK: 20x leverage + 10% SL. If price rises 10% from entry,
  //   the stop triggers. With 10% SL at 20x: loss = 10% × 20 = 200%
  //   of margin → always size using the 1% capital risk rule so the
  //   DOLLAR loss = 1% × capital, regardless of the leverage used.
  //
  // Trigger sequence (monitored every 2 min by scanner):
  //   1. STH Realized Price is fetched from CoinGlass / rules.json
  //   2. Current BTC price is compared to STH line
  //   3. If proximity ≤ touch_pct (3%) AND is CONVERGING (getting
  //      closer since the last few scans) → setup fires as SHORT
  //   4. No reversal candle required (10% SL gives more room)
  STH_REALIZED_PRICE: {
    id: "STH_REALIZED_PRICE",
    name: "Setup 2 — STH Realized Price SHORT",
    description:
      "BTC aproximando da STH Realized Price (linha amarela bitcoinmagazinepro.com) → SHORT 20x, SL 10%",
    leverage: 20,
    sl_pct: 0.10,      // 10% — price must rise 10% above entry for BTC to be stopped
    tp_r: { tp1: 1.5, tp2: 2.5, tp3: 4.0 },
    enabled: true,
    symbols: ["BTCUSDT"],
    direction: "SHORT", // always SHORT — never LONG from this setup
    // Proximity thresholds:
    touch_pct: 0.03,           // 3% — start alerting when price within 3% of STH line
    converge_threshold_pct: 2, // if proximity dropped ≥2pp since last check → converging
  },

  // ── Setup 3 ─ S/R Breakout + Retest (1H levels + 15min entry) ───────
  // Identifies horizontal support/resistance from 1H swing highs/lows.
  // Waits for a clean 15min breakout THROUGH the level (3+ bar closes),
  // then enters when price returns to retest the broken level.
  //
  // Logic:
  //   1. Find key S/R from 1H swing highs/lows (last 50 bars)
  //   2. Confirm 15min breakout: 6+ of last 10 bar closes on the new side
  //   3. Retest: price returns within retest_tolerance_pct of the level
  //   4. Reversal candle at the retest confirms institutional buying/selling
  //   5. EMA200 and weekly bias as bonus/penalty
  //
  // Why it works: when resistance becomes support (or vice versa), the
  // "level flip" is where trapped traders are squeezed and new positions
  // are added by institutions. This is the highest-volume entry zone.
  //
  // Note: RSI/StochRSI/MACD are NOT used as entry triggers here.
  // They are ONLY used as weekly direction bias via _computeWeeklyBias().
  SR_BREAKOUT_RETEST: {
    id: "SR_BREAKOUT_RETEST",
    name: "Setup 3 — Rompimento + Reteste de S/R (1H + 15min)",
    description:
      "Nível-chave do 1H rompido com fechamento + reteste no 15min = entrada na virada de S/R",
    leverage: 4,
    sl_pct: 0.007,
    tp_r: { tp1: 1.618, tp2: 2.618, tp3: 4.236 },
    enabled: true,
    symbols: null,
    retest_tolerance_pct: 0.015, // 1.5% — price must return within 1.5% of broken level
    min_touches: 2,              // minimum number of swing points defining the S/R zone
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
