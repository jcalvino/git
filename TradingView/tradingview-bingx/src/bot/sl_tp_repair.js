// ─────────────────────────────────────────────────────────────────
//  SL/TP Repair — Audit & Fix Active BingX Positions
//
//  Checks every open USDC-M position on BingX for missing Stop-Loss
//  or Take-Profit orders. When found, reads the expected SL/TP prices
//  from the local DB trade record (or recalculates using strategy
//  defaults if the trade was opened externally) and places the missing
//  orders.
//
//  Usage:
//    import { repairMissingSLTP } from "./sl_tp_repair.js";
//    const report = await repairMissingSLTP();
// ─────────────────────────────────────────────────────────────────

import { getPositions, getOpenOrders, placeSlTpOrders } from "../exchanges/bingx.js";
import { getOpenTrades } from "../storage/trades.js";
import { STRATEGY } from "../config/strategy.js";
import { logError, logInfo } from "./error_tracker.js";
import config from "../config/index.js";

/**
 * Audit all open BingX USDC-M positions:
 *   - Cross-reference against open orders (STOP_MARKET / TAKE_PROFIT_MARKET)
 *   - For positions missing SL or TP1 → apply them from the local trade record
 *     (or recalculate from strategy defaults if no local record exists)
 *
 * @returns {Promise<{ checked: number, fixed: number, errors: string[], report: object[] }>}
 */
export async function repairMissingSLTP() {
  const result = { checked: 0, fixed: 0, errors: [], report: [] };

  if (config.paperTrade) {
    console.log("[SL/TP REPAIR] Paper mode — skipping BingX audit");
    result.report.push({ symbol: "—", note: "Paper mode: nenhuma ação realizada" });
    return result;
  }

  // ── 1. Fetch live state from BingX ────────────────────────────
  const [positions, openOrders, localTrades] = await Promise.all([
    getPositions().catch(() => []),
    getOpenOrders().catch(() => []),
    Promise.resolve(getOpenTrades()),
  ]);

  if (positions.length === 0) {
    result.report.push({ symbol: "—", note: "Sem posições abertas na BingX" });
    return result;
  }

  // ── 2. Index open orders by symbol + positionSide ──────────────
  // type: "STOP_MARKET"          → stop loss
  // type: "TAKE_PROFIT_MARKET"   → take profit
  const orderIndex = {};
  for (const o of openOrders) {
    const sym  = o.symbol ?? "";
    const side = o.positionSide ?? (o.side === "BUY" ? "LONG" : "SHORT");
    const key  = `${sym}|${side}`;
    if (!orderIndex[key]) orderIndex[key] = { sl: [], tp: [] };
    const t = (o.type ?? "").toUpperCase();
    if (t === "STOP_MARKET")        orderIndex[key].sl.push(o);
    if (t === "TAKE_PROFIT_MARKET") orderIndex[key].tp.push(o);
  }

  // ── 3. Index local DB trades by symbol + direction ─────────────
  const tradeIndex = {};
  for (const t of localTrades) {
    const key = `${t.symbol}|${t.direction}`;
    // Keep the most recent if multiple (shouldn't happen)
    if (!tradeIndex[key]) tradeIndex[key] = t;
  }

  // ── 4. For each position, check and repair ─────────────────────
  for (const pos of positions) {
    result.checked++;
    const bxSymbol  = pos.symbol;                   // e.g. "BTC-USDC"
    const localSym  = bxSymbol.replace("-", "");    // e.g. "BTCUSDC"
    const direction = pos.side;                     // "LONG" | "SHORT"
    const key       = `${bxSymbol}|${direction}`;
    const dbKey     = `${localSym}|${direction}`;

    const orders    = orderIndex[key] ?? { sl: [], tp: [] };
    const hasSL     = orders.sl.length > 0;
    const hasTP     = orders.tp.length > 0;

    const entry     = { symbol: bxSymbol, direction, size: pos.size, entry: pos.entryPrice };

    if (hasSL && hasTP) {
      entry.note   = `OK — SL ×${orders.sl.length}, TP ×${orders.tp.length}`;
      entry.status = "ok";
      result.report.push(entry);
      continue;
    }

    // ── Need to apply missing order(s) ────────────────────────────
    const trade      = tradeIndex[dbKey];
    const slPct      = STRATEGY.SYMBOL_SL_PCT?.[localSym] ?? STRATEGY.SL_PCT ?? 0.005;

    // Determine SL/TP prices
    let slPrice, tp1Price, tp2Price, tp3Price;

    if (trade && trade.sl_price > 0) {
      slPrice  = trade.sl_price;
      tp1Price = trade.tp1_price;
      tp2Price = trade.tp2_price;
      tp3Price = trade.tp3_price;
    } else {
      // Recalculate from strategy defaults
      const sl = pos.entryPrice * slPct;
      slPrice  = direction === "LONG"
        ? pos.entryPrice - sl
        : pos.entryPrice + sl;

      const { TP1, TP2, TP3 } = STRATEGY.FIB_LEVELS;
      const dist = Math.abs(pos.entryPrice - slPrice);
      tp1Price = direction === "LONG"
        ? pos.entryPrice + dist * TP1
        : pos.entryPrice - dist * TP1;
      tp2Price = direction === "LONG"
        ? pos.entryPrice + dist * TP2
        : pos.entryPrice - dist * TP2;
      tp3Price = direction === "LONG"
        ? pos.entryPrice + dist * TP3
        : pos.entryPrice - dist * TP3;
    }

    // Skip if we couldn't determine prices
    if (!slPrice || !tp1Price) {
      const msg = `Cannot determine SL/TP for ${direction} ${bxSymbol} — skipping`;
      console.warn(`[SL/TP REPAIR] ${msg}`);
      entry.status = "skipped";
      entry.note   = msg;
      result.errors.push(msg);
      result.report.push(entry);
      continue;
    }

    const missing = [];
    if (!hasSL) missing.push("SL");
    if (!hasTP) missing.push("TP");

    console.log(
      `[SL/TP REPAIR] ${direction} ${bxSymbol}: missing ${missing.join(", ")} ` +
      `| entry=$${pos.entryPrice} SL=$${slPrice.toFixed(2)} TP1=$${tp1Price.toFixed(2)}`
    );

    try {
      const placed = await placeSlTpOrders({
        symbol: bxSymbol,
        direction,
        size: pos.size,
        slPrice,
        tp1Price,
        tp2Price,
        tp3Price,
      });

      const slOk  = placed.sl?.orderId  && !placed.sl?.error;
      const tp1Ok = placed.tp1?.orderId && !placed.tp1?.error;

      if (!slOk) {
        const err = `SL placement failed for ${direction} ${bxSymbol}: ${placed.sl?.error ?? "unknown"}`;
        logError("error", "SL_TP_REPAIR", err, { symbol: bxSymbol, direction, slPrice });
        result.errors.push(err);
      }

      logInfo("SL_TP_REPAIR", `Applied ${missing.join("+")} for ${direction} ${bxSymbol}`, {
        sl: placed.sl, tp1: placed.tp1, slPrice, tp1Price,
      });

      result.fixed++;
      entry.status  = "fixed";
      entry.fixed   = missing;
      entry.slPrice = slPrice;
      entry.tp1Price = tp1Price;
      entry.slResult  = placed.sl;
      entry.tp1Result = placed.tp1;
      entry.note    = `Aplicado: ${missing.join(", ")}`;
    } catch (err) {
      const msg = `Failed to apply SL/TP for ${direction} ${bxSymbol}: ${err.message}`;
      console.error(`[SL/TP REPAIR] ${msg}`);
      logError("error", "SL_TP_REPAIR", msg, { symbol: bxSymbol, direction });
      result.errors.push(msg);
      entry.status = "error";
      entry.note   = msg;
    }

    result.report.push(entry);
  }

  console.log(
    `[SL/TP REPAIR] Complete — ${result.checked} checked, ${result.fixed} fixed, ` +
    `${result.errors.length} errors`
  );

  return result;
}
