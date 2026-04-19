// ─────────────────────────────────────────────────────────────────
//  Executor — Places Orders on BingX After Manual Approval
//  Called when user clicks APROVAR in the dashboard.
// ─────────────────────────────────────────────────────────────────

import { placeOrder, placeLimitOrder, setLeverage, getPositions, placeSlTpOrders } from "../exchanges/bingx.js";
import { getSignal, openTrade, updateSignalStatus } from "../storage/trades.js";
import { checkRiskRules } from "../strategy/risk.js";
import { analyzeMacro } from "../analysis/macro.js";
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
  const [openPositions, macro] = await Promise.all([
    getPositions(),
    analyzeMacro(),
  ]);

  const riskCheck = checkRiskRules({
    openPositions,
    score: signal.score,
    macroAnalysis: macro,
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

  // ── Scale-in: place N LIMIT orders ────────────────────────────
  const scaleEntries  = signal.scale_entries ?? [];
  const scaleOrders   = [];
  let   firstOrderResult = null;

  if (scaleEntries.length > 0) {
    // Place each scale entry as a LIMIT (GTC) order
    for (const entry of scaleEntries) {
      try {
        const order = await placeLimitOrder({
          symbol: bingxSymbol,
          side,
          positionSide,
          quantity: entry.size,
          price:    entry.price,
        });
        scaleOrders.push({ index: entry.index, price: entry.price, orderId: order.orderId });
        if (!firstOrderResult) firstOrderResult = order;
        console.log(
          `[EXECUTOR] Scale entry ${entry.index}/${scaleEntries.length}: ` +
          `LIMIT ${side} ${entry.size} @ $${entry.price.toLocaleString()} → #${order.orderId}`
        );
      } catch (err) {
        console.warn(`[EXECUTOR] Scale entry ${entry.index} failed: ${err.message}`);
        scaleOrders.push({ index: entry.index, price: entry.price, orderId: null, error: err.message });
      }
    }
  } else {
    // Fallback: single market order (scale_entries not set)
    try {
      firstOrderResult = await placeOrder({
        symbol: bingxSymbol, side, positionSide, quantity: signal.position_size,
      });
    } catch (err) {
      return { success: false, error: `Order failed: ${err.message}` };
    }
  }

  if (!firstOrderResult) {
    return { success: false, error: "All scale entries failed — no position opened" };
  }

  // Save trade using the avg entry price (scale-in target)
  const avgEntry = signal.avg_entry ?? signal.entry;
  const tradeId  = openTrade(signalId, { ...firstOrderResult, price: avgEntry, scaleOrders });

  // ── SL + TP on full expected position size ─────────────────────
  // Placed immediately — covers worst-case (all entries fill).
  // If only partial fill: BingX only closes what's open.
  let slTpResult = null;
  try {
    slTpResult = await placeSlTpOrders({
      symbol:   bingxSymbol,
      direction: signal.direction,
      size:     signal.position_size,
      slPrice:  signal.sl,
      tp1Price: signal.tp1,
      tp2Price: signal.tp2,
      tp3Price: signal.tp3,
    });
  } catch (err) {
    console.warn(`[EXECUTOR] SL/TP placement failed: ${err.message}`);
  }

  const scaleLog = scaleOrders
    .map((o) => `    Entry ${o.index}: $${o.price.toLocaleString()} → ${o.orderId ?? o.error ?? "?"}`)
    .join("\n");

  const slTpLog = slTpResult
    ? `  SL: ${slTpResult.sl?.orderId ?? slTpResult.sl?.error ?? "?"} | ` +
      `TP1: ${slTpResult.tp1?.orderId ?? "?"} | TP2: ${slTpResult.tp2?.orderId ?? "?"} | TP3: ${slTpResult.tp3?.orderId ?? "?"}`
    : "  SL/TP placement skipped";

  console.log(
    `[EXECUTOR] Trade #${tradeId} aberto: ${signal.direction} ${signal.symbol}\n` +
    `  ${scaleEntries.length} entradas LIMIT (scale-in):\n${scaleLog}\n` +
    `  Avg entry: $${avgEntry.toLocaleString()} | SL: $${signal.sl.toLocaleString()} | TP1: $${signal.tp1.toLocaleString()}\n` +
    `  ${slTpLog}\n` +
    `  Modo: ${config.paperTrade ? "PAPER" : "LIVE"}`
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
