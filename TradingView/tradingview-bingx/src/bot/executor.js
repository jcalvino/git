// ─────────────────────────────────────────────────────────────────
//  Executor — Places Orders on BingX After Manual Approval
//  Called when user clicks APROVAR in the dashboard.
// ─────────────────────────────────────────────────────────────────

import { placeOrder, placeLimitOrder, setLeverage, getPositions, getBalance, placeSlTpOrders } from "../exchanges/bingx.js";
import { getSignal, openTrade, updateSignalStatus, isDailyLimitReached, isDailyTargetReached, getDailyPnl } from "../storage/trades.js";
import { checkRiskRules } from "../strategy/risk.js";
import { analyzeMacro } from "../analysis/macro.js";
import { logError, logWarn, logInfo } from "./error_tracker.js";
import config from "../config/index.js";
import { STRATEGY } from "../config/strategy.js";

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

  // ── Daily loss limit — block execution, analysis already ran ──
  const liveCapital = config.capitalUsdt;
  if (isDailyLimitReached(liveCapital, STRATEGY.DAILY_RISK_PCT)) {
    updateSignalStatus(signalId, "REJECTED");
    logInfo("EXECUTOR", `Daily loss limit active — signal #${signalId} blocked`, {
      symbol: signal.symbol, direction: signal.direction,
    });
    return {
      success: false,
      error: "Daily loss limit reached — no new trades until tomorrow",
    };
  }

  // ── Daily profit target — block execution if hard stop is set ──
  const profitTarget = STRATEGY.DAILY_PROFIT_TARGET ?? 0;
  if (profitTarget > 0 && isDailyTargetReached(profitTarget)) {
    updateSignalStatus(signalId, "REJECTED");
    logInfo("EXECUTOR", `Daily profit target active — signal #${signalId} blocked`, {
      symbol: signal.symbol, direction: signal.direction,
    });
    return {
      success: false,
      error: `Daily profit target ($${profitTarget}) reached — no new trades until tomorrow`,
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
    totalCapital:    balance?.total    ?? liveCapital,
    dailyPnl:        getDailyPnl(),
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
  // Símbolo interno → formato BingX API.
  // Projeto opera em USDC-M (BTC-USDC → BTC-USDC); USDT é legacy.
  // NCC*/NCFX*/NCSK* já vêm com hífen → pass-through.
  const bingxSymbol = signal.symbol.includes("-")
    ? signal.symbol
    : signal.symbol.endsWith("USDC")
      ? signal.symbol.slice(0, -4) + "-USDC"
      : signal.symbol.endsWith("USDT")
        ? signal.symbol.slice(0, -4) + "-USDT"
        : signal.symbol;
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

  // ── SL verification — CRITICAL: close trade if SL could not be placed ──
  const slFailed =
    !slTpResult ||                                        // placeSlTpOrders threw
    slTpResult.sl?.paper ||                               // paper mode (ok)
    (!slTpResult.sl?.orderId && !slTpResult.sl?.paper);  // real mode, no orderId

  if (slTpResult && !slTpResult.sl?.paper) {
    const slOk = slTpResult.sl?.orderId && !slTpResult.sl?.error;
    if (!slOk) {
      const slErr = slTpResult.sl?.error ?? "unknown error";
      console.error(`[EXECUTOR] ⚠ SL FAILED on trade #${tradeId} ${signal.direction} ${signal.symbol}: ${slErr}`);
      logError("error", "EXECUTOR",
        `CRITICAL: SL placement failed on trade #${tradeId} — closing position immediately to prevent unprotected exposure`,
        { tradeId, slPrice: signal.sl, error: slErr, symbol: signal.symbol }
      );

      // ── Safety close: market-close the position immediately ──────
      try {
        const { closeTrade } = await import("./executor.js");
        await closeTrade(tradeId, "SL_PLACEMENT_FAILED");
        console.error(`[EXECUTOR] ⚠ Trade #${tradeId} closed immediately — no SL was accepted by BingX`);
        return {
          success: false,
          tradeId,
          error: `SL placement failed (${slErr}) — position closed immediately for safety`,
        };
      } catch (closeErr) {
        console.error(`[EXECUTOR] EMERGENCY: Could not close trade #${tradeId} after SL failure: ${closeErr.message}`);
        logError("error", "EXECUTOR",
          `EMERGENCY: Trade #${tradeId} is OPEN WITHOUT SL and could not be closed automatically — MANUAL ACTION REQUIRED`,
          { tradeId, symbol: signal.symbol, direction: signal.direction }
        );
      }
    }
    // TP1 só gera warn em LIVE mode (em paper não há orderId, nem é falha).
    if (!slTpResult.tp1?.paper) {
      const tp1Ok = slTpResult.tp1?.orderId && !slTpResult.tp1?.error;
      if (!tp1Ok) {
        logWarn("EXECUTOR", `TP1 order failed on trade #${tradeId} ${signal.symbol}`,
          { error: slTpResult.tp1?.error });
      }
    }
  }

  const entryLog = scaleOrders
    .map((o) => `    Entry ${o.index} [${o.type ?? "?"}]: $${o.price?.toLocaleString()} → ${o.orderId ?? o.error ?? "?"}`)
    .join("\n");

  // Em paper mode não há orderId real — mostramos "PAPER" em vez do
  // misleading "FAILED: ?". Monitor.js é quem vai efetivamente fechar
  // a posição comparando preço corrente vs. sl_price/tp*_price no DB.
  const fmtSlTp = (obj) => {
    if (!obj) return "—";
    if (obj.paper) return "PAPER";
    return obj.orderId ?? (obj.error ? `FAILED: ${obj.error}` : "?");
  };
  const slTpLog = slTpResult
    ? `  SL: ${fmtSlTp(slTpResult.sl)} | TP1: ${fmtSlTp(slTpResult.tp1)} | ` +
      `TP2: ${fmtSlTp(slTpResult.tp2)} | TP3: ${fmtSlTp(slTpResult.tp3)}`
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

  const bingxSymbol = trade.symbol.includes("-")
    ? trade.symbol
    : trade.symbol.endsWith("USDC")
      ? trade.symbol.replace("USDC", "-USDC")
      : trade.symbol.replace("USDT", "-USDT");
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
