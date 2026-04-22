// ─────────────────────────────────────────────────────────────────
//  Position Monitor
//  Watches open positions and triggers SL/TP actions.
//  Polls BingX every 30 seconds (configurable).
// ─────────────────────────────────────────────────────────────────

import { fileURLToPath } from "url";
import { getPrice, getPositions } from "../exchanges/bingx.js";
import { getCoinMPositions } from "../exchanges/bingx_coinm.js";
import {
  getOpenTrades,
  getOpenPositions,
  updatePosition,
  recordPartialClose,
  closeTrade,
  upsertBingXPosition,
} from "../storage/trades.js";
import { placeOrder } from "../exchanges/bingx.js";
import config, { refreshCapital } from "../config/index.js";
import { STRATEGY } from "../config/strategy.js";

const POLL_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Check a single open trade against current price.
 * Returns any actions taken.
 */
async function checkTrade(trade, currentPrice) {
  const actions = [];

  // EXTERNAL trades are opened directly on BingX (not via this bot).
  // BingX already holds their SL/TP orders — do NOT send duplicate close
  // orders. These trades are managed entirely by the exchange; we only
  // track them in the dashboard via syncAllPositions().
  if (trade.trade_type === "EXTERNAL") return actions;

  // Safety guard: if SL/TP were never set (0), skip to avoid false triggers.
  // (A zero sl_price would pass the SHORT slHit check since any price >= 0.)
  if (!trade.sl_price || !trade.tp1_price) {
    console.warn(`[MONITOR] Skipping trade #${trade.id} ${trade.direction} ${trade.symbol} — sl_price or tp1_price is 0`);
    return actions;
  }

  const isLong = trade.direction === "LONG";

  // Get position state from DB
  const pos = getOpenPositions().find((p) => p.trade_id === trade.id);
  if (!pos) return actions;

  // Unrealized P&L
  const direction = isLong ? 1 : -1;
  const unrealizedPnl =
    (currentPrice - trade.entry_price) * trade.size * direction;
  updatePosition(trade.id, currentPrice, unrealizedPnl);

  // ── Stop Loss ──────────────────────────────────────────────────
  const slHit = isLong
    ? currentPrice <= trade.sl_price
    : currentPrice >= trade.sl_price;

  if (slHit) {
    console.log(
      `[MONITOR] SL hit on trade #${trade.id} ${trade.symbol} ${trade.direction}\n` +
        `  Price: $${currentPrice.toLocaleString()} | SL: $${trade.sl_price.toLocaleString()}`
    );
    await executeTpOrSl(trade, "SL", currentPrice, trade.size);
    actions.push({ type: "SL", trade: trade.id, price: currentPrice });
    return actions; // trade is closed, no more checks
  }

  // ── Take Profits ───────────────────────────────────────────────
  if (!pos.tp1_hit) {
    const tp1Hit = isLong
      ? currentPrice >= trade.tp1_price
      : currentPrice <= trade.tp1_price;

    if (tp1Hit) {
      const closeSize = parseFloat(
        (trade.size * STRATEGY.TP_DISTRIBUTION.TP1).toFixed(6)
      );
      console.log(
        `[MONITOR] TP1 hit on trade #${trade.id} ${trade.symbol}\n` +
          `  Price: $${currentPrice.toLocaleString()} | Closing ${(STRATEGY.TP_DISTRIBUTION.TP1 * 100).toFixed(0)}% (${closeSize})`
      );
      await executeTpOrSl(trade, "TP1", currentPrice, closeSize);
      recordPartialClose(trade.id, "TP1", currentPrice, closeSize);
      actions.push({ type: "TP1", trade: trade.id, price: currentPrice, pnl: unrealizedPnl * STRATEGY.TP_DISTRIBUTION.TP1 });
    }
  }

  if (!pos.tp2_hit && pos.tp1_hit) {
    const tp2Hit = isLong
      ? currentPrice >= trade.tp2_price
      : currentPrice <= trade.tp2_price;

    if (tp2Hit) {
      const closeSize = parseFloat(
        (trade.size * STRATEGY.TP_DISTRIBUTION.TP2).toFixed(6)
      );
      console.log(
        `[MONITOR] TP2 hit on trade #${trade.id} ${trade.symbol}\n` +
          `  Price: $${currentPrice.toLocaleString()} | Closing ${(STRATEGY.TP_DISTRIBUTION.TP2 * 100).toFixed(0)}%`
      );
      await executeTpOrSl(trade, "TP2", currentPrice, closeSize);
      recordPartialClose(trade.id, "TP2", currentPrice, closeSize);
      actions.push({ type: "TP2", trade: trade.id, price: currentPrice });
    }
  }

  if (!pos.tp3_hit && pos.tp2_hit) {
    const tp3Hit = isLong
      ? currentPrice >= trade.tp3_price
      : currentPrice <= trade.tp3_price;

    if (tp3Hit) {
      const closeSize = parseFloat(
        (trade.size * STRATEGY.TP_DISTRIBUTION.TP3).toFixed(6)
      );
      console.log(
        `[MONITOR] TP3 hit on trade #${trade.id} ${trade.symbol}\n` +
          `  Price: $${currentPrice.toLocaleString()} | Closing remaining ${(STRATEGY.TP_DISTRIBUTION.TP3 * 100).toFixed(0)}%`
      );
      await executeTpOrSl(trade, "TP3", currentPrice, closeSize);
      closeTrade(trade.id, currentPrice, "TP3");
      actions.push({ type: "TP3", trade: trade.id, price: currentPrice });
    }
  }

  return actions;
}

// Convert internal symbol (e.g. BTCUSDT, XAUUSDT) to BingX API format
function _toBingXSymbol(symbol) {
  // BingX format uses hyphens: BTC-USDT, XAU-USDT
  // Find the last occurrence of USDT and insert a hyphen before it
  if (symbol.endsWith("USDT")) {
    return symbol.slice(0, -4) + "-USDT";
  }
  return symbol; // fallback (e.g. BTC-USD for Coin-M)
}

async function executeTpOrSl(trade, type, price, size) {
  if (config.paperTrade) {
    console.log(`  [PAPER] Would place reduce order: ${type} ${size} @ $${price}`);
    if (type === "SL" || type === "TP3") {
      closeTrade(trade.id, price, type);
    }
    return;
  }

  const bingxSymbol = _toBingXSymbol(trade.symbol);
  // Hedge mode: close by specifying closeSide + positionSide — do NOT send reduceOnly
  const closeSide = trade.direction === "LONG" ? "SELL" : "BUY";

  try {
    await placeOrder({
      symbol: bingxSymbol,
      side: closeSide,
      positionSide: trade.direction,
      quantity: size,
    });
    if (type === "SL" || type === "TP3") {
      closeTrade(trade.id, price, type);
    }
  } catch (err) {
    // 101205 = "No position to close" — BingX already closed it via its own SL/TP order.
    // Treat as successful: sync local DB to reflect what BingX did.
    if (err.message?.includes("101205") || err.message?.includes("No position")) {
      console.log(
        `  [MONITOR] ${type} already closed by BingX for trade #${trade.id} ${trade.symbol} — syncing DB`
      );
      if (type === "SL" || type === "TP3") {
        closeTrade(trade.id, price, type);
      } else {
        recordPartialClose(trade.id, type, price, size);
      }
    } else {
      console.error(`  ERROR placing ${type} order: ${err.message}`);
    }
  }
}

// ── Main Monitor Loop ──────────────────────────────────────────

async function monitorOnce() {
  // ── Sync live positions from BingX → local DB ─────────────────
  // This ensures external positions (opened manually or on another device)
  // are always visible in the dashboard without waiting for a scan.
  try {
    // COINM_ENABLED only gates new order placement — always read positions.
    const [usdtPositions, coinmPositions] = await Promise.allSettled([
      getPositions(),
      getCoinMPositions(),
    ]);

    const allLive = [
      ...(usdtPositions.status === "fulfilled" ? usdtPositions.value : []),
      ...(coinmPositions.status === "fulfilled" ? coinmPositions.value : []),
    ];

    for (const pos of allLive) {
      upsertBingXPosition(pos);
    }
  } catch {
    // No API keys or paper mode — skip sync silently
  }

  // ── Refresh capital so position sizing stays current ───────────
  await refreshCapital();

  const openTrades = getOpenTrades();
  if (openTrades.length === 0) return [];

  const symbols = [...new Set(openTrades.map((t) => t.symbol))];
  const prices = {};

  await Promise.all(
    symbols.map(async (s) => {
      try {
        prices[s] = await getPrice(_toBingXSymbol(s));
      } catch {
        prices[s] = null;
      }
    })
  );

  const allActions = [];
  for (const trade of openTrades) {
    const price = prices[trade.symbol];
    if (!price) continue;
    const actions = await checkTrade(trade, price);
    allActions.push(...actions);
  }

  return allActions;
}

async function startMonitor() {
  console.log(
    `Position monitor started (polling every ${POLL_INTERVAL_MS / 1000}s)`
  );

  const loop = async () => {
    try {
      const actions = await monitorOnce();
      if (actions.length > 0) {
        console.log(
          `[MONITOR] ${actions.length} action(s) taken: ${actions.map((a) => a.type).join(", ")}`
        );
      }
    } catch (err) {
      console.error(`[MONITOR] Error: ${err.message}`);
    }
    setTimeout(loop, POLL_INTERVAL_MS);
  };

  await loop();
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const statusOnly = process.argv.includes("--status");
  if (statusOnly) {
    const trades = getOpenTrades();
    if (trades.length === 0) {
      console.log("No open trades.");
    } else {
      for (const t of trades) {
        console.log(
          `Trade #${t.id}: ${t.direction} ${t.symbol} | Entry: $${t.entry_price} | SL: $${t.sl_price} | TP1: $${t.tp1_price}`
        );
      }
    }
    process.exit(0);
  }
  await startMonitor();
}

export { monitorOnce, startMonitor };
