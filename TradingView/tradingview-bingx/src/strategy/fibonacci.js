// ─────────────────────────────────────────────────────────────────
//  Fibonacci Take-Profit Calculator
//  Computes TP levels based on risk distance (R multiples).
// ─────────────────────────────────────────────────────────────────

import { STRATEGY } from "../config/strategy.js";

/**
 * Calculate entry, stop loss, and Fibonacci take-profit levels.
 *
 * @param {number} entryPrice       — current market price
 * @param {"LONG"|"SHORT"} direction
 * @param {number} [slPctOverride]  — SL % from setup config (overrides STRATEGY.SL_PCT)
 * @param {object} [tpROverride]    — TP R-multiples from setup config { tp1, tp2, tp3 }
 * @returns {TradeLevels}
 */
export function calculateLevels(entryPrice, direction, slPctOverride, tpROverride) {
  const slPct = slPctOverride ?? STRATEGY.SL_PCT;
  const fibLevels = tpROverride ?? STRATEGY.FIB_LEVELS;
  const { TP_DISTRIBUTION } = STRATEGY;
  const isLong = direction === "LONG";

  // Stop loss price
  const slPrice = isLong
    ? entryPrice * (1 - slPct)
    : entryPrice * (1 + slPct);

  // Risk distance in price units (R)
  const riskDistance = Math.abs(entryPrice - slPrice);

  // Take profit prices
  const tp1Price = isLong
    ? entryPrice + riskDistance * fibLevels.tp1
    : entryPrice - riskDistance * fibLevels.tp1;

  const tp2Price = isLong
    ? entryPrice + riskDistance * fibLevels.tp2
    : entryPrice - riskDistance * fibLevels.tp2;

  const tp3Price = isLong
    ? entryPrice + riskDistance * fibLevels.tp3
    : entryPrice - riskDistance * fibLevels.tp3;

  // R:R ratios
  const rr1 = fibLevels.tp1;
  const rr2 = fibLevels.tp2;
  const rr3 = fibLevels.tp3;

  return {
    direction,
    entry: round(entryPrice),
    sl: round(slPrice),
    slPct: (slPct * 100).toFixed(2),
    riskDistance: round(riskDistance),

    tp1: {
      price: round(tp1Price),
      rrRatio: `1:${rr1}`,
      closePercent: (TP_DISTRIBUTION.TP1 * 100).toFixed(0),
      fibLevel: "1.618",
    },
    tp2: {
      price: round(tp2Price),
      rrRatio: `1:${rr2}`,
      closePercent: (TP_DISTRIBUTION.TP2 * 100).toFixed(0),
      fibLevel: "2.618",
    },
    tp3: {
      price: round(tp3Price),
      rrRatio: `1:${rr3}`,
      closePercent: (TP_DISTRIBUTION.TP3 * 100).toFixed(0),
      fibLevel: "4.236",
    },
  };
}

/**
 * Calculate position size based on risk amount.
 *
 * Logic:
 *  - Each trade slot = CAPITAL_ALLOCATION_PCT of total capital (20% → 5 slots)
 *  - Risk per trade  = maxRiskPct of total capital (1% of $128 = $1.28)
 *  - Position size   = riskDollars / riskPerUnit
 *  - Hard cap        = position value cannot exceed the slot allocation ($25.60)
 *
 * @param {number} entryPrice
 * @param {number} slPrice
 * @param {number} capitalUsdt — total available capital
 * @param {number} maxRiskPct — e.g., 0.01 for 1%
 * @returns {{ positionSize, positionValue, riskDollars, tradeCapital, riskPct, wasCapped }}
 */
export function calculatePositionSize(entryPrice, slPrice, capitalUsdt, maxRiskPct) {
  // Trade slot: 20% of total capital
  const tradeCapital = capitalUsdt * STRATEGY.CAPITAL_ALLOCATION_PCT;
  // Risk dollars: 1% of total capital
  const riskDollars = capitalUsdt * maxRiskPct;
  const riskPerUnit = Math.abs(entryPrice - slPrice);

  if (riskPerUnit === 0) {
    throw new Error("Entry and SL prices cannot be equal");
  }

  const rawSize = riskDollars / riskPerUnit;
  const rawValue = rawSize * entryPrice;

  // Cap: position value cannot exceed the trade slot (20% of capital)
  const wasCapped = rawValue > tradeCapital;
  const cappedSize = wasCapped ? tradeCapital / entryPrice : rawSize;

  return {
    positionSize: parseFloat(cappedSize.toFixed(6)),
    positionValue: round(cappedSize * entryPrice),
    riskDollars: round(riskDollars),
    tradeCapital: round(tradeCapital),
    riskPct: (maxRiskPct * 100).toFixed(2),
    wasCapped,
  };
}

/**
 * Format levels for display in terminal or dashboard.
 */
export function formatLevels(levels, sizing) {
  const dir = levels.direction;
  const arrow = dir === "LONG" ? "↑" : "↓";

  return [
    `${arrow} ${dir} @ $${levels.entry.toLocaleString()}`,
    `  SL: $${levels.sl.toLocaleString()} (-${levels.slPct}%) | Risk: $${sizing.riskDollars}`,
    `  TP1 [${levels.tp1.closePercent}%]: $${levels.tp1.price.toLocaleString()} (${levels.tp1.rrRatio})`,
    `  TP2 [${levels.tp2.closePercent}%]: $${levels.tp2.price.toLocaleString()} (${levels.tp2.rrRatio})`,
    `  TP3 [${levels.tp3.closePercent}%]: $${levels.tp3.price.toLocaleString()} (${levels.tp3.rrRatio})`,
    `  Size: ${sizing.positionSize} (value: $${sizing.positionValue})`,
  ].join("\n");
}

function round(n, decimals = 2) {
  return parseFloat(n.toFixed(decimals));
}
