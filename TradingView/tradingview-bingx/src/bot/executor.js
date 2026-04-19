// ─────────────────────────────────────────────────────────────────
//  Executor — Places Orders on BingX After Manual Approval
//  Called when user clicks APROVAR in the dashboard.
// ─────────────────────────────────────────────────────────────────

import { placeOrder, placeLimitOrder, setLeverage, getPositions, getBalance, placeSlTpOrders } from "../exchanges/bingx.js";
import { getSignal, openTrade, updateSignalStatus } from "../storage/trades.js";
import { checkRiskRules } from "../strategy/risk.js";
import { analyzeMacro } from "../analysis/macro.js";
import { logError, logWarn } from "./error_tracker.js";
import config from "../config/index.js";

/**
 * Execute a trade from an approved signal.
 *
 * @param {number} signalId — ID from signals table
 * @returns {{ success: boolean, tradeId?: number, error?: string }}
 */
export async function executeSignal(signalId) {
  const signal = getSignal(signalId);

  if (!signal) {
    return { success: false, error: `Signal ${signalId} not found` };
  }

  if (signal.status !== "PENDING_APPROVAL") {
    return {
      success: false,
      error: `Signal ${signalId} is ${signal.status}, not PENDING_APPROVAL`,
    };
  }

  // Re-check risk rules before executing
  const [openPositions, macro, balance] = await Promise.all([
    getPositions(),
    analyzeMacro(),
    getBalance().catch(() => null),  // non-critical — paper mode or no API key
  ]);

  const riskCheck = checkRiskRules({
    openPositions,
    score: signal.score,
    macroAnalysis: macro,
    availableMargin: balance?.available ?? null,
    totalCapital:    balance?.total    ?? null,
  });

  if (!riskCheck.allowed) {
    const reason = riskCheck.reasons.join("; ");
    updateSignalStatus(signalId, "REJECTED");
    return {
      success: false,
      error: `Risk check failed: ${reason}`,
      reasons: riskCheck.reasons,
    };
  }

  // Set leverage for the correct side before placing orders
  const bingxSymbol = signal.symbol.replace("USDT", "-USDT");
  await setLeverage(bingxSymbol, signal.leverage ?? 1, signal.direction).catch((err) =>
    console.warn(`Could not set leverage: ${err.message}`)
  );

  const side         = signal.direction === "LONG" ? "BUY" : "SELL";
  const positionSide = signal.direction;

  // ── Scale-in entry strategy ────────────────────────────────────
  // ROOT CAUSE FIX: BingX rejects STOP_MARKET orders when no position
  // exists yet (scale-in LIMIT orders pending but unfilled).
  //
  // Solution: Entry 1 is always a MARKET order so the position is
  // immediately established and the SL can be placed right after.
  // Entries 2-N remain LIMIT orders at progressively better prices,
  // preserving the scale-in average-entry benefit.
  const scaleEntries  = signal.scale_entries ?? [];
  const scaleOrders   = [];
  let   firstOrderResult = null;

  if (scaleEntries.length > 0) {
    const [firstEntry, ...restEntries] = scaleEntries;

    // ── Entry 1: MARKET — establishes position immediately ────────
    try {
      firstOrderResult = await placeOrder({
        symbol: bingxSymbol,
        side,
        positionSide,
        quantity: firstEntry.size,
      });
      scaleOrders.push({ index: firstEntry.index, price: firstEntry.price, orderId: firstOrderResult.orderId, type: "MARKET" });
      console.log(
        `[EXECUTOR] Entry 1/${scaleEntries.length}: MARKET ${side} ${firstEntry.size} ${bingxSymbol}` +
        ` @ ~$${firstOrderResult.price?.toLocaleString() ?? "?"} → #${firstOrderResult.orderId}`
      );
    } catch (err) {
      return { success: false, error: `Entry 1 (market) failed: ${err.message}` };
    }

    // ── Entries 2-N: LIMIT at progressively better prices ─────────
    for (const entry of restEntries) {
      try {
        const order = await placeLimitOrder({
          symbol: bingxSymbol,
          side,
          positionSide,
          quantity: entry.size,
          price:    entry.price,
        });
        scaleOrders.push({ index: entry.index, price: entry.price, orderId: order.orderId, type: "LIMIT" });
        console.log(
          `[EXECUTOR] Entry ${entry.index}/${scaleEntries.length}: LIMIT ${side} ${entry.size}` +
          ` @ $${entry.price.toLocaleString()} → #${order.orderId}`
        );
      } catch (err) {
        console.warn(`[EXECUTOR] Entry ${entry.index} (LIMIT) failed: ${err.message}`);
        scaleOrders.push({ index: entry.index, price: entry.price, orderId: null, error: err.message });
      }
    }
  } else {
    // No scale entries — single market order
    try {
      firstOrderResult = await placeOrder({
        symbol: bingxSymbol, side, positionSide, quantity: signal.position_size,
      });
    } catch (err) {
      return { success: false, error: `Order failed: ${err.message}` };
    }
  }

  if (!firstOrderResult) {
    return { success: false, error: "Entry failed — no position opened" };
  }

  // Save trade record (position now open via market entry)
  const avgEntry = signal.avg_entry ?? signal.entry;
  const tradeId  = openTrade(signalId, { ...firstOrderResult, price: avgEntry, scaleOrders });

  // ── SL + TP — position is open, BingX will accept these ──────────
  let slTpResult = null;
  try {
    slTpResult = await placeSlTpOrders({
      symbol:    bingxSymbol,
      direction: signal.direction,
      size:      signal.position_size,
      slPrice:   signal.sl,
      tp1Price:  signal.tp1,
      tp2Price:  signal.tp2,
      tp3Price:  signal.tp3,
    });
  } catch (err) {
    const msg = `SL/TP placement threw: ${err.message}`;
    console.error(`[EXECUTOR] ${msg}`);
    logError("error", "EXECUTOR",
      `CRITICAL: No SL on trade #${tradeId} ${signal.direction} ${signal.symbol} — ${msg}`,
      { tradeId, sl: signal.sl, symbol: signal.symbol }
    );
  }

  // Verify SL specifically — surface failure prominently
  if (slTpResult) {
    const slOk = slTpResult.sl?.orderId && !slTpResult.sl?.error;
    if (!slOk) {
      const slErr = slTpResult.sl?.error ?? "unknown error";
      console.error(`[EXECUTOR] SL order FAILED on trade #${tradeId}: ${slErr}`);
      logError("error", "EXECUTOR",
        `CRITICAL: No SL on trade #${tradeId} ${signal.direction} ${signal.symbol} — BingX rejected SL order`,
        { tradeId, slPrice: signal.sl, error: slErr, symbol: signal.symbol }
      );
    }
    const tp1Ok = slTpResult.tp1?.orderId && !slTpResult.tp1?.error;
    if (!tp1Ok) {
      logWarn("EXECUTOR", `TP1 order failed on trade #${tradeId} ${signal.symbol}`,
        { error: slTpResult.tp1?.error });
    }
  }

  const entryLog = scaleOrders
    .map((o) => `    Entry ${o.index} [${o.type ?? "?"}]: $${o.price?.toLocaleString()} → ${o.orderId ?? o.error ?? "?"}`)
    .join("\n");

  const slTpLog = slTpResult
    ? `  SL: ${slTpResult.sl?.orderId ?? ("FAILED: " + (slTpResult.sl?.error ?? "?"))} | ` +
      `TP1: ${slTpResult.tp1?.orderId ?? slTpResult.tp1?.error ?? "?"} | ` +
      `TP2: ${slTpResult.tp2?.orderId ?? "?"} | TP3: ${slTpResult.tp3?.orderId ?? "?"}`
    : "  SL/TP: not attempted";

  console.log(
    `[EXECUTOR] Trade #${tradeId}: ${signal.direction} ${signal.symbol}\n` +
    `  Entries (${scaleOrders.length}):\n${entryLog}\n` +
    `  Avg entry: $${avgEntry?.toLocaleString()} | SL: $${signal.sl?.toLocaleString()} | TP1: $${signal.tp1?.toLocaleString()}\n` +
    `  ${slTpLog}\n` +
    `  Mode: ${config.paperTrade ? "PAPER" : "LIVE"}`
  );

  return { success: true, tradeId, scaleOrders, slTpResult };
}

/**
 * Close a trade (market order).
 */
export async function closeTrade(tradeId, reason = "MANUAL") {
  const { getTrade, closeTrade: saveClose } = await import("../storage/trades.js");
  const trade = getTrade(tradeId);

  if (!trade) return { success: false, error: `Trade ${tradeId} not found` };
  if (trade.status === "CLOSED") return { success: false, error: "Trade already closed" };

  const bingxSymbol = trade.symbol.replace("USDT", "-USDT");
  const closeSide = trade.direction === "LONG" ? "SELL" : "BUY";

  let exitPrice;
  try {
    // Hedge mode: close by specifying closeSide + positionSide — do NOT send reduceOnly
    const result = await placeOrder({
      symbol: bingxSymbol,
      side: closeSide,
      positionSide: trade.direction,
      quantity: trade.size,
    });
    exitPrice = result.price ?? trade.entry_price;
  } catch (err) {
    return { success: false, error: `Close order failed: ${err.message}` };
  }

  const closeResult = saveClose(tradeId, exitPrice, reason);

  console.log(
    `[EXECUTOR] Trade #${tradeId} closed: ${reason}\n` +
      `  Exit: $${exitPrice.toLocaleString()} | P&L: $${closeResult.pnl.toFixed(2)} (${closeResult.pnlPct.toFixed(2)}%)`
  );

  return { success: true, ...closeResult };
}
