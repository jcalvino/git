// ─────────────────────────────────────────────────────────────────
//  Signal Engine (Setup-Based)
//  Evaluates all 5 named setups for a symbol and generates a signal
//  for the highest-confidence triggered setup.
//
//  Each signal includes:
//  - setup_id / setup_name  → which setup triggered
//  - rationale[]            → WHY this trade was entered (shown in dashboard)
//  - leverage               → setup-specific leverage
//  - direction / entry / sl / tp1 / tp2 / tp3
// ─────────────────────────────────────────────────────────────────

import { fileURLToPath } from "url";
import { analyzeOnChain } from "../analysis/onchain.js";
import { analyzeOrderBook } from "../analysis/orderbook.js";
import { analyzeMacro } from "../analysis/macro.js";
import { evaluateSetups } from "./setups.js";
import { calculateLevels, calculatePositionSize } from "./fibonacci.js";
import { calcScaleEntries } from "./risk.js";
import config from "../config/index.js";
import { STRATEGY } from "../config/strategy.js";

/**
 * Generate a trade signal for a symbol.
 * Evaluates all 5 setups and returns the highest-confidence triggered one.
 *
 * @param {string} symbol            — e.g. "BTCUSDT"
 * @param {object} technicalAnalysis — result from analyzeTechnical()
 * @param {object} [macroCache]      — reuse macro analysis across symbols
 * @returns {Signal|null}            — null if no setup triggered above MIN_SCORE
 */
export async function generateSignal(symbol, technicalAnalysis, macroCache = null) {
  const price = technicalAnalysis.price;

  // Fetch supporting data in parallel
  const [onChain, macro] = await Promise.all([
    analyzeOnChain(symbol),
    macroCache ? Promise.resolve(macroCache) : analyzeMacro(),
  ]);

  // Evaluate all setups (includes STH, liquidation, OI filter internally)
  const triggeredSetups = await evaluateSetups(symbol, technicalAnalysis, onChain);

  if (!triggeredSetups.length) {
    return _noSignal(symbol, price, "Nenhum dos 5 setups ativado neste momento");
  }

  // Pick the highest-confidence setup
  const best = triggeredSetups[0];

  if (best.confidence < STRATEGY.MIN_SCORE) {
    return _noSignal(
      symbol,
      price,
      `Setup "${best.setup_name}" com confiança ${best.confidence}% abaixo do mínimo (${STRATEGY.MIN_SCORE}%)`
    );
  }

  // Per-symbol SL override (commodities need wider SL — see strategy.js)
  const slPct = STRATEGY.SYMBOL_SL_PCT?.[symbol] ?? best.sl_pct ?? STRATEGY.SL_PCT;

  // Per-symbol leverage cap (Oil max 5x, Gold max 10x)
  const maxLev = STRATEGY.SYMBOL_MAX_LEVERAGE?.[symbol] ?? 30;
  const leverage = Math.min(best.leverage, maxLev);

  // ── Scale-in entry levels ─────────────────────────────────────
  // Build N limit order prices, calculate avg entry and SL from last level
  const scale = STRATEGY.SCALE_IN;
  const scaleResult = calcScaleEntries({
    entry:      price,
    direction:  best.direction,
    slPct,
    entries:    scale.ENTRIES,
    spacingPct: scale.SPACING_PCT,
  });

  // TPs are calculated from the AVERAGE entry price for accurate R:R
  const levels = calculateLevels(scaleResult.avgEntry, best.direction, slPct, best.tp_r);

  // Position sizing: risk = 1% of capital, distance = avgEntry → scaleResult.slPrice
  const sizing = calculatePositionSize(
    scaleResult.avgEntry,
    scaleResult.slPrice,
    config.capitalUsdt,
    config.maxRiskPct
  );

  // Build per-entry breakdown (equal size split)
  const partialSize  = parseFloat((sizing.positionSize / scale.ENTRIES).toFixed(6));
  const scaleEntries = scaleResult.levels.map((entryPrice, i) => ({
    index: i + 1,
    price: entryPrice,
    size:  partialSize,
    value: parseFloat((partialSize * entryPrice).toFixed(2)),
  }));

  // Append macro + market context to rationale
  const fullRationale = [...best.rationale];
  if (macro?.fearGreed?.value !== undefined) {
    fullRationale.push(
      `Fear & Greed: ${macro.fearGreed.value}/100 (${macro.fearGreed.classification ?? ""}) — ${_fearGreedContext(macro.fearGreed.value, best.direction)}`
    );
  }
  if (macro?.context?.overallBias) {
    fullRationale.push(`Macro bias (rules.json): ${macro.context.overallBias}`);
  }

  // Determine trade type from confidence + setup
  const tradeType = best.confidence >= 85 ? "POSITION" : "SWING";

  return {
    symbol,
    direction:  best.direction,
    score:      best.confidence,    // confidence = score for dashboard compat
    setup_id:   best.setup_id,
    setup_name: best.setup_name,
    leverage,   // capped by per-symbol max
    tradeType,
    rationale:  fullRationale,

    // Price levels
    // entry   = first scale level (primary signal price)
    // sl      = 1% below LAST scale entry (worst-case protection)
    // tp1/2/3 = calculated from AVERAGE entry for accurate R:R
    price,
    entry:    scaleResult.levels[0],    // first limit order price
    avgEntry: scaleResult.avgEntry,     // used for TP calculation
    sl:       scaleResult.slPrice,      // 1% below last scale entry
    tp1:      levels.tp1.price,
    tp2:      levels.tp2.price,
    tp3:      levels.tp3.price,
    tpDistribution: {
      tp1Pct: STRATEGY.TP_DISTRIBUTION.TP1,
      tp2Pct: STRATEGY.TP_DISTRIBUTION.TP2,
      tp3Pct: STRATEGY.TP_DISTRIBUTION.TP3,
    },

    // Scale-in configuration
    scaleEntries, // [{ index, price, size, value }, ...]
    scaleConfig: {
      entries:    scale.ENTRIES,
      spacingPct: scale.SPACING_PCT,
      lastEntry:  scaleResult.lastEntry,
      avgEntry:   scaleResult.avgEntry,
    },

    // Position sizing (based on avgEntry → slPrice)
    sizing,

    // Supporting data (shown in dashboard details)
    inputs: {
      technical: {
        price,
        ema200d:   technicalAnalysis.daily.ema200,
        ema21w:    technicalAnalysis.weekly.ema21,
        macd:      technicalAnalysis.weekly.macd,
        rsiW:      technicalAnalysis.weekly.rsi,
        stochRsiW: technicalAnalysis.weekly.stochRsi,
      },
      onchain: {
        funding:      onChain.funding,
        longShort:    onChain.longShort,
        openInterest: onChain.openInterest,
      },
      macro: {
        fearGreed:   macro?.fearGreed,
        overallBias: macro?.context?.overallBias,
      },
      allSetups: triggeredSetups.map((s) => ({
        id:         s.setup_id,
        direction:  s.direction,
        confidence: s.confidence,
      })),
    },

    createdAt: new Date().toISOString(),
    status:    "PENDING_APPROVAL",
  };
}

// ── Helpers ────────────────────────────────────────────────────

function _noSignal(symbol, price, reason) {
  return {
    symbol,
    direction:  null,
    score:      0,
    setup_id:   null,
    setup_name: null,
    leverage:   1,
    tradeType:  null,
    rationale:  [reason],
    price,
    entry: null, sl: null, tp1: null, tp2: null, tp3: null,
    sizing: null,
    inputs: {},
    createdAt: new Date().toISOString(),
    status: "BELOW_THRESHOLD",
  };
}

function _fearGreedContext(value, direction) {
  if (direction === "LONG") {
    if (value < 25) return "extremo medo = oportunidade de compra contrariana";
    if (value < 45) return "medo = favorável para entradas long";
    if (value < 65) return "neutro/ganância moderada = aceitável";
    return "ganância extrema = cuidado com overextension";
  } else {
    if (value > 75) return "ganância extrema = oportunidade de short contrarian";
    if (value > 55) return "ganância = favorável para entradas short";
    return "medo = atenção ao risco de squeeze";
  }
}

// ── Self-test ──────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("Testando signal engine com dados mock...\n");

  const mockTechnical = {
    symbol: "BTCUSDT",
    price:  84500,
    timestamp: new Date().toISOString(),
    daily: {
      ema200: 68000,
      priceAboveEma200: true,
      barCount: 250,
      bars: Array.from({ length: 30 }, (_, i) => ({
        open:  82000 + i * 100,
        high:  82500 + i * 100,
        low:   81500 + i * 100,
        close: 82200 + i * 100,
        time:  Date.now() - (30 - i) * 86400000,
      })),
    },
    weekly: {
      ema21: 78000,
      priceAboveEma21: true,
      macd: { macdLine: 1500, signalLine: 1200, histogram: 300, crossingUp: true, crossingDown: false },
      rsi:  62,
      stochRsi: { k: 72, d: 65, crossingUp: true, crossingDown: false, overbought: false, oversold: false },
      barCount: 100,
    },
    _raw: { dailyCloses: [82200, 83400, 84500], weeklyCloses: [75000, 80000, 84500] },
  };

  try {
    const signal = await generateSignal("BTCUSDT", mockTechnical);
    console.log(`Symbol    : ${signal.symbol}`);
    console.log(`Setup     : ${signal.setup_name ?? "nenhum"}`);
    console.log(`Direction : ${signal.direction}`);
    console.log(`Confidence: ${signal.score}%`);
    console.log(`Leverage  : ${signal.leverage}x`);
    console.log(`Status    : ${signal.status}`);
    if (signal.entry) {
      console.log(`\nLevels:`);
      console.log(`  Entry : $${signal.entry.toLocaleString()}`);
      console.log(`  SL    : $${signal.sl.toLocaleString()}`);
      console.log(`  TP1   : $${signal.tp1.toLocaleString()}`);
      console.log(`  TP2   : $${signal.tp2.toLocaleString()}`);
      console.log(`  TP3   : $${signal.tp3.toLocaleString()}`);
    }
    console.log(`\nRationale:`);
    signal.rationale.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  } catch (err) {
    console.error("Erro:", err.message);
    if (process.env.DEBUG) console.error(err);
  }
}
