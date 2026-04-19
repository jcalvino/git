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
 * @param {object[]} openPositions   — current open positions from BingX
 * @param {number}   score           — signal score (0–100)
 * @param {object}   macroAnalysis   — from analyzeMacro()
 * @param {number}   [availableMargin] — free margin in account (USDT)
 * @param {number}   [totalCapital]    — total equity in account (USDT)
 * @returns {{ allowed: boolean, reasons: string[] }}
 */
export function checkRiskRules({ openPositions, score, macroAnalysis, availableMargin = null, totalCapital = null }) {
  const reasons = [];
  let allowed = true;

  // 1. Capital reserve guard — keep MIN_FREE_CAPITAL_PCT always available.
  //    No hard cap on position count; the constraint is capital, not slots.
  if (availableMargin !== null && totalCapital !== null && totalCapital > 0) {
    const freeCapitalPct = availableMargin / totalCapital;
    const minFree        = STRATEGY.MIN_FREE_CAPITAL_PCT ?? 0.20;
    if (freeCapitalPct < minFree) {
      allowed = false;
      reasons.push(
        `Capital livre insuficiente: ${(freeCapitalPct * 100).toFixed(1)}% disponível ` +
        `(mínimo ${(minFree * 100).toFixed(0)}%) — aguardando fechamento de posição`
      );
    }
  }
  // Informational: log how many positions are open (no hard block)
  if (openPositions.length > 0) {
    reasons.push(`INFO: ${openPositions.length} posição(ões) aberta(s) atualmente`);
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
 * Each entry has its own individual SL at sl_pct from that entry price.
 * ⚠ Risk note: if all entries fill and all stops are hit simultaneously,
 *   total loss = N × 1% of capital (capped by daily limit in practice).
 *
 * The executor places a stop for ONLY the first (market) entry initially.
 * Monitor.js should update stops as limit entries fill.
 *
 * @param {object} params
 * @param {number} params.entry       — signal entry price (first scale level)
 * @param {string} params.direction   — "LONG" | "SHORT"
 * @param {number} params.slPct       — stop loss % per entry (e.g. 0.005 = 0.5%)
 * @param {number} params.entries     — number of scale levels
 * @param {number} params.spacingPct  — price step between levels (e.g. 0.003 = 0.3%)
 * @returns {{ levels, slPrices, avgEntry, lastEntry, slPrice }}
 */
export function calcScaleEntries({ entry, direction, slPct, entries, spacingPct }) {
  const levels   = [];
  const slPrices = [];

  for (let i = 0; i < entries; i++) {
    const factor = direction === "LONG"
      ? 1 - i * spacingPct   // lower prices = better avg entry for LONG
      : 1 + i * spacingPct;  // higher prices = better avg entry for SHORT

    const entryPrice = parseFloat((entry * factor).toFixed(2));
    levels.push(entryPrice);

    // Individual SL for this entry: sl_pct distance in adverse direction
    const sl = direction === "LONG"
      ? parseFloat((entryPrice * (1 - slPct)).toFixed(2))
      : parseFloat((entryPrice * (1 + slPct)).toFixed(2));
    slPrices.push(sl);
  }

  const avgEntry  = levels.reduce((sum, p) => sum + p, 0) / levels.length;
  const lastEntry = levels[levels.length - 1];

  // Signal-level SL = last (worst) entry's individual SL
  // This is what the initial BingX stop order is set to.
  const slPrice = slPrices[slPrices.length - 1];

  return {
    levels,     // array of limit prices [entry1, entry2, ...]
    slPrices,   // array of individual SL prices (one per entry)
    avgEntry:   parseFloat(avgEntry.toFixed(2)),
    lastEntry,
    slPrice,    // = slPrices[last] — used for the signal's single SL field
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
