// ─────────────────────────────────────────────────────────────────
//  Risk Manager — Professional Edition (v2)
//
//  Novo nesta versão:
//   • Break-even após TP1 (trade-runner mode)
//   • Daily risk limit mais rigoroso (0.5%)
//   • Monthly profit floor tracking ($100)
//   • Monthly/weekly P&L helpers para analytics
// ─────────────────────────────────────────────────────────────────

import config from "../config/index.js";
import { STRATEGY } from "../config/strategy.js";

// ═══════════════════════════════════════════════════════════════════
//  PRE-TRADE RISK RULES
// ═══════════════════════════════════════════════════════════════════

export function checkRiskRules({
  openPositions,
  score,
  macroAnalysis,
  availableMargin = null,
  totalCapital    = null,
  dailyPnl        = 0,
}) {
  const reasons  = [];
  const warnings = [];
  let allowed    = true;

  // DAILY LOSS CIRCUIT BREAKER (0.5%)
  if (totalCapital !== null && totalCapital > 0) {
    const limitPct     = STRATEGY.DAILY_RISK_PCT ?? 0.005;
    const limitDollars = -(totalCapital * limitPct);
    if (dailyPnl <= limitDollars) {
      allowed = false;
      reasons.push(
        `DAILY LOSS LIMIT atingido: $${dailyPnl.toFixed(2)} <= $${limitDollars.toFixed(2)} ` +
        `(${(limitPct * 100).toFixed(2)}% de $${totalCapital.toFixed(2)}). Bot pausado ate proximo dia UTC.`
      );
    } else if (dailyPnl < limitDollars * 0.6) {
      warnings.push(
        `Daily risk em ${((dailyPnl / limitDollars) * 100).toFixed(0)}% do limite ` +
        `($${dailyPnl.toFixed(2)} / $${limitDollars.toFixed(2)})`
      );
    }
  }

  // CAPITAL RESERVE GUARD
  if (availableMargin !== null && totalCapital !== null && totalCapital > 0) {
    const freeCapitalPct = availableMargin / totalCapital;
    const minFree        = STRATEGY.MIN_FREE_CAPITAL_PCT ?? 0.20;
    if (freeCapitalPct < minFree) {
      allowed = false;
      reasons.push(
        `Capital livre insuficiente: ${(freeCapitalPct * 100).toFixed(1)}% ` +
        `(minimo ${(minFree * 100).toFixed(0)}%) — aguardando fechamento de posicao`
      );
    }
  }

  if (openPositions.length > 0) {
    warnings.push(`INFO: ${openPositions.length} posicao(oes) aberta(s)`);
  }

  // MINIMUM SCORE
  if (score < (config.minScore ?? STRATEGY.MIN_SCORE)) {
    allowed = false;
    reasons.push(
      `Score ${score} abaixo do minimo ${config.minScore ?? STRATEGY.MIN_SCORE}`
    );
  }

  // MACRO EVENT WARNINGS
  if (macroAnalysis?.hasHighRisk) {
    const events = macroAnalysis.riskWarnings
      .filter((w) => w.severity === "high")
      .map((w) => w.type);
    warnings.push(
      `Evento de alto risco ativo (${events.join(", ")}) — score ja penalizado`
    );
  }

  if (macroAnalysis?.fearGreed?.value <= 20) {
    warnings.push(
      `Medo extremo (${macroAnalysis.fearGreed.value}) — reduzir tamanho em 50%`
    );
  }

  return { allowed, reasons, warnings };
}

// ═══════════════════════════════════════════════════════════════════
//  BREAK-EVEN LOGIC
// ═══════════════════════════════════════════════════════════════════

export function calculateBreakEvenPrice(entryPrice, direction, bufferPct = null) {
  const buffer = bufferPct ?? STRATEGY.BREAK_EVEN?.BUFFER_PCT ?? 0.0005;
  if (direction === "LONG") {
    return parseFloat((entryPrice * (1 + buffer)).toFixed(8));
  }
  return parseFloat((entryPrice * (1 - buffer)).toFixed(8));
}

export function calculateTrailStopAfterTP2(entryPrice, tp2Price, direction) {
  const midpoint = entryPrice + (tp2Price - entryPrice) * 0.5;
  return parseFloat(midpoint.toFixed(8));
}

export function shouldMoveStopLoss(trade, position) {
  if (!STRATEGY.BREAK_EVEN?.ENABLED) return null;
  if (!trade || !position) return null;
  if (trade.status === "CLOSED" || trade.status === "STOPPED") return null;

  const direction = trade.direction;
  const entry     = trade.entry_price;
  const currentSl = trade.sl_price;

  // TRAIL apos TP2
  if (STRATEGY.BREAK_EVEN?.TRAIL_AFTER_TP2 && position.tp2_hit && trade.tp2_price) {
    const trailSl  = calculateTrailStopAfterTP2(entry, trade.tp2_price, direction);
    const isBetter = direction === "LONG" ? trailSl > currentSl : trailSl < currentSl;
    if (isBetter) {
      return {
        newSl: trailSl,
        reason: "Trail stop apos TP2: SL = 50% do caminho entry->TP2",
        type: "TRAIL",
      };
    }
  }

  // BREAK-EVEN apos TP1
  if (position.tp1_hit && !position.tp2_hit) {
    const beSl     = calculateBreakEvenPrice(entry, direction);
    const isBetter = direction === "LONG" ? beSl > currentSl : beSl < currentSl;
    if (isBetter) {
      return {
        newSl: beSl,
        reason: "Break-even apos TP1: trade protegido, runner gratis",
        type: "BE",
      };
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
//  SCALE-IN ENTRIES
// ═══════════════════════════════════════════════════════════════════

export function calcScaleEntries({ entry, direction, slPct, entries, spacingPct }) {
  const levels   = [];
  const slPrices = [];

  for (let i = 0; i < entries; i++) {
    const factor = direction === "LONG"
      ? 1 - i * spacingPct
      : 1 + i * spacingPct;

    const entryPrice = parseFloat((entry * factor).toFixed(2));
    levels.push(entryPrice);

    const sl = direction === "LONG"
      ? parseFloat((entryPrice * (1 - slPct)).toFixed(2))
      : parseFloat((entryPrice * (1 + slPct)).toFixed(2));
    slPrices.push(sl);
  }

  const avgEntry  = levels.reduce((sum, p) => sum + p, 0) / levels.length;
  const lastEntry = levels[levels.length - 1];
  const slPrice   = slPrices[slPrices.length - 1];

  return {
    levels,
    slPrices,
    avgEntry:   parseFloat(avgEntry.toFixed(2)),
    lastEntry,
    slPrice,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  POSITION SIZING
// ═══════════════════════════════════════════════════════════════════

export function calculateTradeSize(entryPrice, slPrice, capitalUsdt, macroAnalysis) {
  let effectiveCapital = capitalUsdt;

  if (macroAnalysis?.fearGreed?.value <= 20) {
    effectiveCapital = capitalUsdt * 0.5;
  }

  const riskDollars   = effectiveCapital * config.maxRiskPct;
  const riskPerUnit   = Math.abs(entryPrice - slPrice);
  const positionSize  = riskDollars / riskPerUnit;
  const positionValue = positionSize * entryPrice;

  const cappedSize =
    positionValue > effectiveCapital
      ? effectiveCapital / entryPrice
      : positionSize;

  return {
    positionSize:     parseFloat(cappedSize.toFixed(6)),
    positionValue:    parseFloat((cappedSize * entryPrice).toFixed(2)),
    riskDollars:      parseFloat(riskDollars.toFixed(2)),
    effectiveCapital: parseFloat(effectiveCapital.toFixed(2)),
    wasCapped:        positionValue > effectiveCapital,
  };
}
