// ─────────────────────────────────────────────────────────────────
//  Position Monitor
//  Watches open positions and triggers SL/TP actions.
//  Polls BingX every 30 seconds (configurable).
// ─────────────────────────────────────────────────────────────────

import { fileURLToPath } from "url";
import { getPrice, getPositions } from "../exchanges/bingx.js";
import {
  getOpenTrades,
  getOpenPositions,
  updatePosition,
  recordPartialClose,
  closeTrade,
  getTotalTradePnl,
  upsertBingXPosition,
  updateTradeStopLoss,
} from "../storage/trades.js";
import { placeOrder, getOpenOrders, cancelOrder } from "../exchanges/bingx.js";
import { onTradeClosedWithProfit } from "../exchanges/withdraw.js";
import { shouldMoveStopLoss } from "../strategy/risk.js";
import config, { refreshCapital } from "../config/index.js";
import { STRATEGY } from "../config/strategy.js";
import { notify } from "./notifier.js";

/**
 * Após qualquer `closeTrade(...)`, checa o P&L total do trade e,
 * se positivo, dispara o fluxo de auto-withdraw. No-op se
 * AUTO_WITHDRAW_ENABLED=false ou PAPER_TRADE=true.
 */
async function _maybeWithdrawProfit(tradeId, symbol) {
  try {
    const totalPnl = getTotalTradePnl(tradeId);
    if (totalPnl <= 0) return;
    await onTradeClosedWithProfit({ symbol, pnl_usdt: totalPnl });
  } catch (err) {
    console.error(`[MONITOR] withdraw hook falhou (trade #${tradeId}): ${err.message}`);
  }
}

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
    notify.tradeClosed(
      { ...trade, exit_price: currentPrice, pnl_pct: unrealizedPnl / (trade.entry_price * trade.size) },
      "SL",
      unrealizedPnl,
      false,
    ).catch(() => {});
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
      const tp1Pnl = unrealizedPnl * STRATEGY.TP_DISTRIBUTION.TP1;
      notify.tradeClosed(
        { ...trade, exit_price: currentPrice, pnl_pct: tp1Pnl / (trade.entry_price * closeSize) },
        "TP1",
        tp1Pnl,
        true,
      ).catch(() => {});
      actions.push({ type: "TP1", trade: trade.id, price: currentPrice, pnl: tp1Pnl });

      // ── BREAK-EVEN APÓS TP1 (Trade-Runner Mode) ─────────────────
      // Move SL para entry + buffer, protegendo o trade restante.
      // Se tudo der errado daqui pra frente, o pior cenário é
      // fechar em ~break-even (capital intocado).
      try {
        await moveToBreakEvenOrTrail(trade);
        actions.push({ type: "BREAK_EVEN", trade: trade.id });
      } catch (err) {
        console.error(`  [BE] Failed to move SL for trade #${trade.id}: ${err.message}`);
      }
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
      const tp2Pnl = unrealizedPnl * STRATEGY.TP_DISTRIBUTION.TP2;
      notify.tradeClosed(
        { ...trade, exit_price: currentPrice, pnl_pct: tp2Pnl / (trade.entry_price * closeSize) },
        "TP2",
        tp2Pnl,
        true,
      ).catch(() => {});
      actions.push({ type: "TP2", trade: trade.id, price: currentPrice });

      // ── TRAIL STOP APÓS TP2 ─────────────────────────────────────
      // Move SL para 50% do caminho entry→TP2.
      // Trava ~50% do ganho parcial mesmo se o trade reverter antes do TP3.
      if (STRATEGY.BREAK_EVEN?.TRAIL_AFTER_TP2) {
        try {
          await moveToBreakEvenOrTrail(trade);
          actions.push({ type: "TRAIL_STOP", trade: trade.id });
        } catch (err) {
          console.error(`  [TRAIL] Failed to move SL for trade #${trade.id}: ${err.message}`);
        }
      }
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
      const tp3Pnl = unrealizedPnl * STRATEGY.TP_DISTRIBUTION.TP3;
      notify.tradeClosed(
        { ...trade, exit_price: currentPrice, pnl_pct: tp3Pnl / (trade.entry_price * closeSize) },
        "TP3",
        tp3Pnl,
        false,
      ).catch(() => {});
      await _maybeWithdrawProfit(trade.id, trade.symbol);
      actions.push({ type: "TP3", trade: trade.id, price: currentPrice });
    }
  }

  return actions;
}

// Convert internal symbol (e.g. BTCUSDC, ETHUSDC) to BingX API format (BTC-USDC).
// O projeto opera apenas em USDC-M após 2026-04-23.
function _toBingXSymbol(symbol) {
  if (symbol.includes("-")) return symbol; // já formatado
  if (symbol.endsWith("USDC")) return symbol.slice(0, -4) + "-USDC";
  return symbol;
}

// ═══════════════════════════════════════════════════════════════════
//  BREAK-EVEN / TRAIL STOP (post-TP1 / post-TP2)
// ═══════════════════════════════════════════════════════════════════

/**
 * Move SL de um trade para break-even (após TP1) ou trail stop (após TP2).
 *
 * - Paper: atualiza apenas o DB (sl_price do trade + position).
 * - Live:  cancela SL order antiga na BingX e coloca nova.
 *
 * A decisão de qual tipo (BE ou TRAIL) é feita dentro de shouldMoveStopLoss,
 * baseado em position.tp1_hit e position.tp2_hit.
 *
 * @param {object} trade — row de trades (já com tp1_hit/tp2_hit atualizados)
 */
async function moveToBreakEvenOrTrail(trade) {
  // Re-ler position para ter tp1_hit/tp2_hit atualizados
  const position = getOpenPositions().find((p) => p.trade_id === trade.id);
  if (!position) return;

  const decision = shouldMoveStopLoss(trade, position);
  if (!decision) return; // não precisa mover

  const { newSl, reason, type } = decision;

  // Sanity check: não mover para pior (já validado em shouldMoveStopLoss, mas defensivo)
  const currentSl = trade.sl_price;
  const worse = trade.direction === "LONG" ? newSl < currentSl : newSl > currentSl;
  if (worse) {
    console.log(`  [${type}] SL atual ($${currentSl}) melhor que proposto ($${newSl}) — skip`);
    return;
  }

  // ── Paper trade: só atualiza DB ─────────────────────────────────
  if (config.paperTrade) {
    updateTradeStopLoss(trade.id, newSl, type);
    console.log(`  [PAPER][${type}] Trade #${trade.id} ${trade.symbol} ${trade.direction}: SL $${currentSl.toFixed(2)} → $${newSl.toFixed(2)} (${reason})`);
    return;
  }

  // ── Live trade: cancela SL antiga na BingX + coloca nova ────────
  const bingxSymbol = _toBingXSymbol(trade.symbol);
  const closeSide   = trade.direction === "LONG" ? "SELL" : "BUY";

  try {
    // 1. Listar open orders para achar a SL antiga
    const openOrders = await getOpenOrders(bingxSymbol);
    const oldSlOrder = openOrders?.find((o) =>
      (o.type === "STOP_MARKET" || o.type === "STOP") &&
      (o.positionSide === trade.direction || o.positionSide === "BOTH" || !o.positionSide)
    );

    if (oldSlOrder) {
      try {
        await cancelOrder(bingxSymbol, oldSlOrder.orderId);
      } catch (cancelErr) {
        console.warn(`  [${type}] Could not cancel old SL order: ${cancelErr.message}`);
      }
    }

    // 2. Colocar nova SL order no break-even price
    await placeOrder({
      symbol:       bingxSymbol,
      side:         closeSide,
      positionSide: trade.direction,
      type:         "STOP_MARKET",
      stopPrice:    newSl,
      quantity:     trade.size, // size restante (TP1 já fechou parte)
    });

    // 3. Atualizar DB
    updateTradeStopLoss(trade.id, newSl, type);
    console.log(`  [${type}] Trade #${trade.id} ${trade.symbol} ${trade.direction}: SL $${currentSl.toFixed(2)} → $${newSl.toFixed(2)}`);
  } catch (err) {
    console.error(`  [${type}] Live SL update failed: ${err.message}`);
    // Ainda atualiza DB para refletir intenção
    updateTradeStopLoss(trade.id, newSl, type + "_DB_ONLY");
    throw err;
  }
}

async function executeTpOrSl(trade, type, price, size) {
  if (config.paperTrade) {
    console.log(`  [PAPER] Would place reduce order: ${type} ${size} @ $${price}`);
    if (type === "SL" || type === "TP3") {
      closeTrade(trade.id, price, type);
      await _maybeWithdrawProfit(trade.id, trade.symbol);
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
      await _maybeWithdrawProfit(trade.id, trade.symbol);
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
        await _maybeWithdrawProfit(trade.id, trade.symbol);
      } else {
        recordPartialClose(trade.id, type, price, size);
      }
    } else {
      console.error(`  ERROR placing ${type} order: ${err.message}`);
    }
  }
}

// ── Main Monitor Loop ──────────────────────────────────────────

/**
 * Executa uma passada completa: sincroniza posicoes com BingX e checa SL/TP
 * em cada trade aberto. Exportada para ser chamada pela API.
 */
export async function monitorOnce() {
  const actions = [];

  // ── 1. Sync live USDC-M positions from BingX → local DB ──────
  try {
    const livePositions = (await getPositions()) ?? [];
    for (const pos of livePositions) {
      try { upsertBingXPosition(pos); } catch (_) { /* continue */ }
    }
  } catch (err) {
    console.warn(`[MONITOR] Sync BingX falhou: ${err.message}`);
  }

  // ── 2. Checar cada trade aberto ──────────────────────────────
  const openTrades = getOpenTrades();
  for (const trade of openTrades) {
    try {
      const bingxSymbol = _toBingXSymbol(trade.symbol);
      const priceData   = await getPrice(bingxSymbol).catch(() => null);
      const currentPrice = priceData?.price ?? priceData ?? null;
      if (!currentPrice) continue;

      // Atualiza position row com mark_price + unrealized_pnl
      const direction = trade.direction;
      const sizeFloat = Number(trade.size) || 0;
      const unrealized = direction === "LONG"
        ? (currentPrice - trade.entry_price) * sizeFloat
        : (trade.entry_price - currentPrice) * sizeFloat;
      try { updatePosition(trade.id, currentPrice, unrealized); } catch (_) {}

      // Dispara SL/TP se atingidos
      const triggered = await checkTrade(trade, currentPrice);
      if (triggered && triggered.length > 0) actions.push(...triggered);

      // Apos TP1 / TP2 tenta mover SL para BE / Trail
      try { await moveToBreakEvenOrTrail(trade); } catch (_) {}
    } catch (err) {
      console.error(`[MONITOR] Erro no trade #${trade.id}: ${err.message}`);
    }
  }

  return actions;
}

// ── Boot: quando executado diretamente como processo ─────────────
const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === __filename;

if (isMain) {
  console.log(`[MONITOR] Iniciando (poll a cada ${POLL_INTERVAL_MS / 1000}s)...`);

  // Ping no Telegram que o monitor subiu (só se TELEGRAM_ENABLED=true).
  // Não mandamos ping se for só --status (execução de um comando rápido).
  if (!process.argv.includes("--status")) {
    notify.startup(`Monitor (${config.paperTrade ? "PAPER" : "LIVE"})`).catch(() => {});
  }

  // CLI --status apenas imprime estado e sai
  if (process.argv.includes("--status")) {
    const trades = getOpenTrades();
    console.log(`Open trades: ${trades.length}`);
    for (const t of trades) {
      console.log(`  #${t.id} ${t.direction} ${t.symbol} @ $${t.entry_price} size=${t.size}`);
    }
    process.exit(0);
  }

  const runLoop = async () => {
    try {
      const actions = await monitorOnce();
      if (actions && actions.length > 0) {
        console.log(`[MONITOR] ${actions.length} action(s):`, actions.map((a) => a.type).join(", "));
      }
    } catch (err) {
      console.error(`[MONITOR] Loop error: ${err.message}`);
    }
  };

  runLoop();
  setInterval(runLoop, POLL_INTERVAL_MS);
}
