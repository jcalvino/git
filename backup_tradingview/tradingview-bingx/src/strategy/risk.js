// ─────────────────────────────────────────────────────────────────
//  Risk Manager
//  Validates trades against risk rules before execution.
// ─────────────────────────────────────────────────────────────────

import config from "../config/index.js";
import { STRATEGY } from "../config/strategy.js";

/**
 * Check if a new trade is allowed given current risk state.
 *
 * @param {object} params
 * @param {object[]} openPositions — current open positions from BingX
 * @param {number} score — signal score (0–100)
 * @param {object} macroAnalysis — from analyzeMacro()
 * @returns {{ allowed: boolean, reasons: string[] }}
 */
export function checkRiskRules({ openPositions, score, macroAnalysis }) {
  const reasons = [];
  let allowed = true;

  // 1. Max open positions
  if (openPositions.length >= STRATEGY.MAX_POSITIONS) {
    allowed = false;
    reasons.push(
      `Max positions (${STRATEGY.MAX_POSITIONS}) reached — ${openPositions.length} open`
    );
  }

  // 2. Minimum score
  if (score < config.minScore) {
    allowed = false;
    reasons.push(
      `Score ${score} below minimum ${config.minScore}`
    );
  }

  // 3. High-risk macro event — WARNING only, does not block user approval
  //    The score already discounts -30% for high-risk events.
  //    Clicking APPROVE in the dashboard is the user's informed override.
  if (macroAnalysis?.hasHighRisk) {
    const events = macroAnalysis.riskWarnings
      .filter((w) => w.severity === "high")
      .map((w) => w.type);
    reasons.push(
      `WARN: High-risk event active (${events.join(", ")}) — score already penalised`
    );
  }

  // 4. Extreme fear — reduce size warning (not a blocker, but flag it)
  if (macroAnalysis?.fearGreed?.value <= 20) {
    reasons.push(
      `WARN: Extreme fear (${macroAnalysis.fearGreed.value}) — consider 50% position size reduction`
    );
  }

  return { allowed, reasons };
}

/**
 * Calculate scaled entry levels for a position.
 *
 * Splits the position into N LIMIT orders at progressively better prices:
 * - LONG:  entries go DOWN by spacing_pct each step (buy cheaper if price dips)
 * - SHORT: entries go UP by spacing_pct each step (sell higher if price rises)
 *
 * SL is placed at sl_pct below/above the LAST (worst) entry price.
 * TPs should be calculated from the avgEntry (returned here) for correct R:R.
 *
 * @param {object} params
 * @param {number} params.entry     — signal entry price (first scale level)
 * @param {string} params.direction — "LONG" | "SHORT"
 * @param {number} params.slPct     — stop loss % (e.g. 0.01 = 1%)
 * @param {number} params.entries   — number of scale levels
 * @param {number} params.spacingPct — price step between levels (e.g. 0.004 = 0.4%)
 * @returns {{ levels, avgEntry, lastEntry, slPrice }}
 */
export function calcScaleEntries({ entry, direction, slPct, entries, spacingPct }) {
  const levels = [];

  for (let i = 0; i < entries; i++) {
    const factor = direction === "LONG"
      ? 1 - i * spacingPct   // lower prices = better avg entry for LONG
      : 1 + i * spacingPct;  // higher prices = better avg entry for SHORT

    levels.push(parseFloat((entry * factor).toFixed(2)));
  }

  const avgEntry  = levels.reduce((sum, p) => sum + p, 0) / levels.length;
  const lastEntry = levels[levels.length - 1];

  const slPrice = direction === "LONG"
    ? parseFloat((lastEntry * (1 - slPct)).toFixed(2))
    : parseFloat((lastEntry * (1 + slPct)).toFixed(2));

  return {
    levels,               // array of limit prices [entry1, entry2, ...]
    avgEntry:  parseFloat(avgEntry.toFixed(2)),
    lastEntry,
    slPrice,
  };
}

/**
 * Calculate the actual trade size considering:
 * - Max risk per trade (1% of capital)
 * - Capital available
 * - 1x leverage (no leverage)
 *
 * For futures with 1x: position value = capital used
 * position size = (capital * riskPct) / (entry - sl)
 */
export function calculateTradeSize(entryPrice, slPrice, capitalUsdt, macroAnalysis) {
  let effectiveCapital = capitalUsdt;

  // In extreme fear, reduce position to 50% per risk rules
  if (macroAnalysis?.fearGreed?.value <= 20) {
    effectiveCapital = capitalUsdt * 0.5;
  }

  const riskDollars = effectiveCapital * config.maxRiskPct;
  const riskPerUnit = Math.abs(entryPrice - slPrice);
  const positionSize = riskDollars / riskPerUnit;
  const positionValue = positionSize * entryPrice;

  // Safety cap: position value cannot exceed total capital (1x)
  const cappedSize =
    positionValue > effectiveCapital
      ? effectiveCapital / entryPrice
      : positionSize;

  return {
    positionSize: parseFloat(cappedSize.toFixed(6)),
    positionValue: parseFloat((cappedSize * entryPrice).toFixed(2)),
    riskDollars: parseFloat(riskDollars.toFixed(2)),
    effectiveCapital: parseFloat(effectiveCapital.toFixed(2)),
    wasCapped: positionValue > effectiveCapital,
  };
}
