// ─────────────────────────────────────────────────────────────────
//  Technical Analysis Module
//  Computes EMA200/D, EMA21/W, MACD/W, RSI/W from raw OHLCV bars.
//
//  No TradingView indicators required — works on any plan (free/paid).
//  REQUIRES: TradingView Desktop running with CDP on :9222
// ─────────────────────────────────────────────────────────────────

import { STRATEGY } from "../config/strategy.js";

/**
 * Analyze a symbol across daily and weekly timeframes.
 * All indicators are computed from raw OHLCV bars — no TradingView
 * indicators need to be added to the chart.
 *
 * @param {string} symbol — e.g. "BTCUSDT"
 * @param {object} mcpTools — adapter returned by createMcpAdapter()
 * @returns {TechnicalAnalysis}
 */
export async function analyzeTechnical(symbol, mcpTools) {
  const { setSymbol, setTimeframe, getOhlcv, getQuote } = mcpTools;

  await setSymbol(symbol);

  // ── Daily: 250 bars for EMA200 ─────────────────────────────────
  await setTimeframe("D");
  const [dailyOhlcv, dailyQuote] = await Promise.all([
    getOhlcv({ count: 250 }),
    getQuote(),
  ]);

  const dailyBars = dailyOhlcv.bars ?? [];
  const dailyCloses = dailyBars.map((b) => b.close);
  const currentPrice = parseFloat(dailyQuote.last ?? dailyQuote.close ?? 0);
  const ema200Value = calcEma(dailyCloses, 200);

  // ── Weekly: 100 bars for EMA21, MACD(26+9), RSI(14) ───────────
  await setTimeframe("W");
  const weeklyOhlcv = await getOhlcv({ count: 100 });
  const weeklyBars = weeklyOhlcv.bars ?? [];
  const weeklyCloses = weeklyBars.map((b) => b.close);

  const ema21Value = calcEma(weeklyCloses, 21);
  const macdResult = calcMacd(weeklyCloses);
  const rsiValue = calcRsi(weeklyCloses, 14);
  const stochRsiResult = calcStochRsi(weeklyCloses, 14, 14, 3, 3);

  return {
    symbol,
    timestamp: new Date().toISOString(),
    price: currentPrice,

    daily: {
      ema200: ema200Value,
      priceAboveEma200: ema200Value !== null ? currentPrice > ema200Value : null,
      barCount: dailyBars.length,
      // Last 30 bars exposed for swing-high/low trendline detection (Setup 1)
      bars: dailyBars.slice(-30).map((b) => ({
        open: b.open, high: b.high, low: b.low, close: b.close, time: b.time,
      })),
    },

    weekly: {
      ema21: ema21Value,
      priceAboveEma21: ema21Value !== null ? currentPrice > ema21Value : null,
      macd: macdResult,
      rsi: rsiValue,
      stochRsi: stochRsiResult,
      barCount: weeklyBars.length,
    },

    _raw: {
      dailyCloses: dailyCloses.slice(-10),
      weeklyCloses: weeklyCloses.slice(-10),
    },
  };
}

/**
 * Score the technical analysis (0–40 points max).
 * Direction: "LONG" | "SHORT"
 */
export function scoreTechnical(analysis, direction) {
  const w = STRATEGY.SCORING_WEIGHTS;
  let score = 0;
  const breakdown = {};

  const isLong = direction === "LONG";
  const { daily, weekly, price } = analysis;

  // EMA 200 Daily (15 pts)
  if (daily.ema200 !== null) {
    const above = price > daily.ema200;
    if ((isLong && above) || (!isLong && !above)) {
      score += w.EMA200_DAILY;
      breakdown.ema200 = `+${w.EMA200_DAILY} (price ${above ? "above" : "below"} EMA200 D)`;
    } else {
      breakdown.ema200 = `0 (price ${above ? "above" : "below"} EMA200 D — against ${direction})`;
    }
  } else {
    breakdown.ema200 = `0 (EMA200 — not enough daily bars: ${daily.barCount})`;
  }

  // EMA 21 Weekly (10 pts)
  if (weekly.ema21 !== null) {
    const above = price > weekly.ema21;
    if ((isLong && above) || (!isLong && !above)) {
      score += w.EMA21_WEEKLY;
      breakdown.ema21 = `+${w.EMA21_WEEKLY} (price ${above ? "above" : "below"} EMA21 W)`;
    } else {
      breakdown.ema21 = `0 (price ${above ? "above" : "below"} EMA21 W — against ${direction})`;
    }
  } else {
    breakdown.ema21 = `0 (EMA21 — not enough weekly bars: ${weekly.barCount})`;
  }

  // MACD Weekly (10 pts)
  if (weekly.macd !== null) {
    const { histogram, crossingUp, crossingDown } = weekly.macd;
    const bullish = histogram > 0 || crossingUp;
    const bearish = histogram < 0 || crossingDown;

    if ((isLong && bullish) || (!isLong && bearish)) {
      score += w.MACD_WEEKLY;
      const reason = crossingUp
        ? "crossing up"
        : crossingDown
        ? "crossing down"
        : `histogram ${histogram > 0 ? "positive" : "negative"}`;
      breakdown.macd = `+${w.MACD_WEEKLY} (MACD W ${reason})`;
    } else {
      breakdown.macd = `0 (MACD W against ${direction})`;
    }
  } else {
    breakdown.macd = `0 (MACD — not enough weekly bars: ${weekly.barCount})`;
  }

  // RSI Weekly (5 pts)
  if (weekly.rsi !== null) {
    const rsi = weekly.rsi;
    const { RSI } = STRATEGY;
    let rsiScore = 0;

    if (isLong) {
      if (rsi >= RSI.NEUTRAL_LOW && rsi <= RSI.OVERBOUGHT) {
        rsiScore = w.RSI_WEEKLY;
        breakdown.rsi = `+${rsiScore} (RSI W ${rsi.toFixed(1)} ideal long zone 40–70)`;
      } else if (rsi > RSI.OVERBOUGHT) {
        breakdown.rsi = `0 (RSI W ${rsi.toFixed(1)} overbought — risky long)`;
      } else {
        breakdown.rsi = `0 (RSI W ${rsi.toFixed(1)} below 40 — wait for momentum)`;
      }
    } else {
      if (rsi >= RSI.OVERSOLD && rsi <= RSI.NEUTRAL_HIGH) {
        rsiScore = w.RSI_WEEKLY;
        breakdown.rsi = `+${rsiScore} (RSI W ${rsi.toFixed(1)} ideal short zone 30–60)`;
      } else if (rsi < RSI.OVERSOLD) {
        breakdown.rsi = `0 (RSI W ${rsi.toFixed(1)} oversold — risky short)`;
      } else {
        breakdown.rsi = `0 (RSI W ${rsi.toFixed(1)} above 60 — wait for momentum)`;
      }
    }
    score += rsiScore;
  } else {
    breakdown.rsi = `0 (RSI — not enough weekly bars: ${weekly.barCount})`;
  }

  return { score, breakdown, maxScore: 40 };
}

// ── Indicator Calculations ─────────────────────────────────────
// Pure JS — no TradingView indicators needed.

/**
 * Exponential Moving Average (last value only).
 * Uses SMA of first `period` bars as seed.
 */
function calcEma(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * EMA as full array (needed for MACD computation).
 * Returns null for positions before the period is reached.
 */
function calcEmaArray(closes, period) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period) return result;

  const k = 2 / (period + 1);
  result[period - 1] = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * MACD (12, 26, 9) — includes crossing detection.
 * Returns null if there are insufficient bars.
 */
function calcMacd(closes) {
  const ema12 = calcEmaArray(closes, 12);
  const ema26 = calcEmaArray(closes, 26);

  // MACD line values where both EMAs are defined
  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    if (ema12[i] !== null && ema26[i] !== null) {
      macdLine.push(ema12[i] - ema26[i]);
    }
  }

  if (macdLine.length < 10) return null; // need ≥9 for signal EMA

  const signalArray = calcEmaArray(macdLine, 9);
  const lastIdx = signalArray.length - 1;
  const prevIdx = lastIdx - 1;

  const lastMacd = macdLine[lastIdx];
  const prevMacd = macdLine[prevIdx];
  const lastSignal = signalArray[lastIdx];
  const prevSignal = signalArray[prevIdx];

  if (lastSignal === null) return null;

  const histogram = lastMacd - lastSignal;
  const prevHistogram = prevSignal !== null ? prevMacd - prevSignal : 0;

  return {
    macdLine: lastMacd,
    signalLine: lastSignal,
    histogram,
    crossingUp: prevHistogram < 0 && histogram > 0,
    crossingDown: prevHistogram > 0 && histogram < 0,
  };
}

/**
 * RSI array (Wilder's smoothing) — returns a value for each bar (null until enough data).
 * Used as input for StochRSI.
 */
function calcRsiArray(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

/**
 * Stochastic RSI (rsiPeriod, stochPeriod, kSmooth, dSmooth).
 * Standard TradingView default: (14, 14, 3, 3).
 * Returns { k, d, crossingUp, crossingDown } for the latest bar, or null if insufficient data.
 *
 * crossingUp:   %K crossed above %D (bullish)
 * crossingDown: %K crossed below %D (bearish)
 */
function calcStochRsi(closes, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
  const rsiArr = calcRsiArray(closes, rsiPeriod);
  const validRsi = rsiArr.filter((v) => v !== null);
  if (validRsi.length < stochPeriod + kSmooth + dSmooth) return null;

  // Compute raw %K (stochastic of RSI values)
  const rawK = [];
  for (let i = stochPeriod - 1; i < validRsi.length; i++) {
    const slice = validRsi.slice(i - stochPeriod + 1, i + 1);
    const lo = Math.min(...slice);
    const hi = Math.max(...slice);
    rawK.push(hi === lo ? 50 : ((validRsi[i] - lo) / (hi - lo)) * 100);
  }

  // Smooth %K with SMA(kSmooth)
  const kSmoothed = [];
  for (let i = kSmooth - 1; i < rawK.length; i++) {
    kSmoothed.push(rawK.slice(i - kSmooth + 1, i + 1).reduce((a, b) => a + b, 0) / kSmooth);
  }

  // %D = SMA(kSmoothed, dSmooth)
  const dSmoothed = [];
  for (let i = dSmooth - 1; i < kSmoothed.length; i++) {
    dSmoothed.push(kSmoothed.slice(i - dSmooth + 1, i + 1).reduce((a, b) => a + b, 0) / dSmooth);
  }

  if (dSmoothed.length < 2) return null;

  const lastK = kSmoothed[kSmoothed.length - 1];
  const lastD = dSmoothed[dSmoothed.length - 1];
  const prevK = kSmoothed[kSmoothed.length - 2];
  const prevD = dSmoothed[dSmoothed.length - 2];

  return {
    k: parseFloat(lastK.toFixed(2)),
    d: parseFloat(lastD.toFixed(2)),
    crossingUp: prevK <= prevD && lastK > lastD,
    crossingDown: prevK >= prevD && lastK < lastD,
    overbought: lastK > 80,
    oversold: lastK < 20,
  };
}

/**
 * RSI (14) using Wilder's smoothing method.
 * Returns null if there are insufficient bars.
 */
function calcRsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // First period: simple average
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;

  // Subsequent: Wilder's smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// ── MCP Tool Adapter ──────────────────────────────────────────
// Connects analyzeTechnical to the TradingView Desktop via CDP.
// Only needs setSymbol, setTimeframe, getOhlcv, getQuote.

export async function createMcpAdapter() {
  try {
    const tvPath = new URL(
      "../../tv-mcp/src/core/index.js",
      import.meta.url
    );
    const core = await import(tvPath.href);

    return {
      setSymbol: (symbol) => core.chart.setSymbol({ symbol }),
      setTimeframe: (timeframe) => core.chart.setTimeframe({ timeframe }),
      getOhlcv: (opts) => core.data.getOhlcv(opts),
      getQuote: () => core.data.getQuote({}),
      // Available for other modules (orderbook, etc.) if needed:
      getStudyValues: () => core.data.getStudyValues(),
      manageIndicator: (opts) => core.chart.manageIndicator(opts),
    };
  } catch (err) {
    throw new Error(
      "Cannot connect to TradingView. Make sure TradingView Desktop is running\n" +
        "with CDP enabled (:9222) and tv-mcp is configured.\n" +
        "Run: .\\scripts\\launch_tv_debug.bat\n" +
        `Details: ${err.message}`
    );
  }
}
