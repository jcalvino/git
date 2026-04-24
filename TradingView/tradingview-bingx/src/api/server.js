// ─────────────────────────────────────────────────────────────────
//  Express REST API Server
//  Serves trade data to the React dashboard (localhost:3001)
// ─────────────────────────────────────────────────────────────────

import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import {
  getPendingSignals,
  getRecentSignals,
  getBelowThresholdSignals,
  getTradeHistory,
  getOpenTrades,
  getOpenPositions,
  getSnapshots,
  getStats,
  updateSignalStatus,
  upsertBingXPosition,
  closeExternalTrade,
  closeBotTradeFromSync,
  clearClosedTrades,
  getMonthlyPnl,
  getWeeklyPnl,
  getDailyPnlSeries,
  getMonthlyPnlSeries,
  getStatsBySetup,
  getStatsBySymbol,
  getDrawdownSeries,
  getCloseReasonBreakdown,
} from "../storage/trades.js";
import { executeSignal, closeTrade } from "../bot/executor.js";
import { monitorOnce } from "../bot/monitor.js";
import { getBalance, getPrice, getPositions, getOpenOrders, placeOrder } from "../exchanges/bingx.js";
import config from "../config/index.js";
import { lastScanSummary } from "../bot/scanner.js";
import { expireStalePendingSignals } from "../bot/signal_expiry.js";
import { getRecentErrors, hasActiveErrors, dismissErrors } from "../bot/error_tracker.js";
import { isDailyLimitReached, getDailyPnl, isDailyTargetReached, getDailyProfit } from "../storage/trades.js";
import { STRATEGY, SETUPS } from "../config/strategy.js";
import { getSTHRealizedPrice, getSTHProximityHistory } from "../analysis/sth_price.js";
import { getMonitorStatus } from "../analysis/price_monitors.js";
import { getMarketMetrics, refreshMarketMetrics } from "../analysis/market_metrics.js";
import { repairMissingSLTP } from "../bot/sl_tp_repair.js";
import { analyzeTrendlines } from "../analysis/trendlines.js";
import { createBinanceAdapter } from "../analysis/technical.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

const __serverDir = dirname(fileURLToPath(import.meta.url));
const __rootDir   = resolve(__serverDir, "../..");
const KB_PATH     = resolve(__rootDir, "data/knowledge_base.md");

const app = express();
app.use(cors());
app.use(express.json());

// ── Health ─────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    mode: config.paperTrade ? "paper" : "live",
    capital: config.capitalUsdt,
    timestamp: new Date().toISOString(),
  });
});

// ── Dashboard Overview ─────────────────────────────────────────
app.get("/api/overview", async (_req, res) => {
  try {
    const priceSymbols = ["BTC-USDC", "ETH-USDC"];
    const priceKeys    = ["BTCUSDC",  "ETHUSDC"];

    const [stats, snapshots, openTrades, ...priceResults] =
      await Promise.allSettled([
        Promise.resolve(getStats()),
        Promise.resolve(getSnapshots(30)),
        Promise.resolve(getOpenTrades()),
        ...priceSymbols.map((s) => getPrice(s)),
      ]);

    // USDC-M futures balance
    let balance = { available: config.capitalUsdt, total: config.capitalUsdt, unrealizedPnl: 0 };
    try { balance = await getBalance(); } catch { /* paper mode */ }

    const prices = {};
    priceKeys.forEach((key, i) => {
      prices[key] = priceResults[i].status === "fulfilled" ? priceResults[i].value : null;
    });

    res.json({
      balance,
      stats:      stats.value ?? {},
      equityCurve: snapshots.value ?? [],
      openTrades: openTrades.value ?? [],
      prices,
      capital:    config.capitalUsdt,  // live-refreshed value
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Signals ────────────────────────────────────────────────────
app.get("/api/signals/pending", (_req, res) => {
  res.json(getPendingSignals());
});

// Watchlist tier: setups que triggeraram mas não cruzaram MIN_SCORE.
// Dashboard usa pra tier "quase entrou" + backtest de calibração de pesos.
app.get("/api/signals/watchlist", (req, res) => {
  const limit = parseInt(req.query.limit ?? "50");
  res.json(getBelowThresholdSignals(limit));
});

app.get("/api/signals", (req, res) => {
  const limit = parseInt(req.query.limit ?? "50");
  res.json(getRecentSignals(limit));
});

app.post("/api/signals/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const result = await executeSignal(id);
    if (result.success) {
      res.json({ success: true, tradeId: result.tradeId });
    } else {
      res.status(400).json({ success: false, error: result.error, reasons: result.reasons });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/signals/:id/reject", (req, res) => {
  const id = parseInt(req.params.id);
  updateSignalStatus(id, "REJECTED");
  res.json({ success: true });
});

// ── Trades ─────────────────────────────────────────────────────
app.get("/api/trades", (req, res) => {
  const { symbol, limit = "50" } = req.query;
  res.json(getTradeHistory(parseInt(limit), symbol));
});

app.get("/api/trades/open", (_req, res) => {
  res.json(getOpenTrades());
});

app.post("/api/trades/:id/close", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const result = await closeTrade(id, "MANUAL");
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Positions ──────────────────────────────────────────────────
app.get("/api/positions", (_req, res) => {
  res.json(getOpenPositions());
});

// ── Shared helper: fetch + upsert all live USDC-M positions ─────
async function syncAllPositions() {
  const [posRes, ordRes] = await Promise.allSettled([
    getPositions(),
    getOpenOrders(),        // all pending SL/TP orders
  ]);

  const orders       = ordRes.status === "fulfilled" ? ordRes.value : [];
  const allPositions = posRes.status === "fulfilled" ? posRes.value : [];

  const synced = [];
  for (const pos of allPositions) {
    const slTp    = extractSlTp(orders, pos.symbol, pos.side);

    if (pos.entryPrice === 0) {
      console.warn(`[SYNC] ${pos.side} ${pos.symbol} — BingX returned entryPrice=0`);
    }

    const localId = upsertBingXPosition({ ...pos, ...slTp });
    synced.push({ symbol: pos.symbol, side: pos.side, market: "USDC-M", localId });
  }

  // ── Auto-close positions no longer live on BingX ──────────────
  // Only auto-close if the positions API call succeeded — never close
  // positions just because the API temporarily failed.
  const liveKeys = new Set(
    allPositions.map((p) => `${p.symbol.replace("-", "")}:${p.side}`)
  );
  const apiOk = posRes.status === "fulfilled";

  const openTrades = getOpenTrades();

  // 1. EXTERNAL trades (created by sync from BingX positions opened manually)
  for (const t of openTrades.filter((t) => t.trade_type === "EXTERNAL")) {
    if (apiOk && !liveKeys.has(`${t.symbol}:${t.direction}`)) {
      closeExternalTrade(t.id);
      console.log(`[SYNC] Auto-closed external #${t.id} ${t.direction} ${t.symbol} — not on BingX`);
    }
  }

  // 2. Bot-created trades — close if no longer on BingX (SL/TP may have hit).
  for (const t of openTrades.filter((t) => t.trade_type !== "EXTERNAL")) {
    if (apiOk && !liveKeys.has(`${t.symbol}:${t.direction}`)) {
      closeBotTradeFromSync(t.id);
      console.log(`[SYNC] Auto-closed bot trade #${t.id} ${t.direction} ${t.symbol} — SL/TP likely hit on BingX`);
    }
  }

  return synced;
}

/**
 * Given a list of open orders from BingX, extract SL and TP prices
 * for a specific position (matched by symbol + positionSide direction).
 *
 * @param {object[]} orders   - raw open orders from BingX API
 * @param {string}   symbol   - BingX format: "BTC-USDC"
 * @param {string}   direction - "LONG" | "SHORT"
 */
function extractSlTp(orders, symbol, direction) {
  if (!orders.length) return { slPrice: 0, tp1Price: 0, tp2Price: 0, tp3Price: 0 };

  // Match by symbol + positionSide first (Hedge mode).
  // Fallback to symbol-only when positionSide is missing or "BOTH" (one-way mode).
  let posOrders = orders.filter(
    (o) => o.symbol === symbol && o.positionSide === direction
  );
  if (posOrders.length === 0) {
    posOrders = orders.filter(
      (o) => o.symbol === symbol &&
        (!o.positionSide || o.positionSide === "BOTH")
    );
  }

  const slOrders = posOrders.filter(
    (o) => o.type === "STOP_MARKET" || o.type === "STOP"
  );
  const tpOrders = posOrders.filter(
    (o) => o.type === "TAKE_PROFIT_MARKET" || o.type === "TAKE_PROFIT"
  );

  const orderPrice = (o) => parseFloat(o?.stopPrice ?? o?.price ?? 0);

  const slPrice = slOrders.length ? orderPrice(slOrders[0]) : 0;

  // Sort TPs: LONG → ascending (tp1 = nearest/lowest), SHORT → descending (tp1 = nearest/highest)
  tpOrders.sort((a, b) =>
    direction === "LONG" ? orderPrice(a) - orderPrice(b) : orderPrice(b) - orderPrice(a)
  );

  return {
    slPrice,
    tp1Price: orderPrice(tpOrders[0]),
    tp2Price: orderPrice(tpOrders[1]),
    tp3Price: orderPrice(tpOrders[2]),
  };
}

// Sync live BingX USDC-M positions into local DB
app.post("/api/positions/sync", async (_req, res) => {
  try {
    const synced = await syncAllPositions();
    res.json({ success: true, count: synced.length, synced });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Close a position directly on BingX by symbol+direction (for external positions)
app.post("/api/positions/close", async (req, res) => {
  const { symbol, direction, size } = req.body;
  if (!symbol || !direction || !size) {
    return res.status(400).json({ success: false, error: "symbol, direction, size required" });
  }
  try {
    const bingxSymbol = symbol.includes("-")
      ? symbol
      : symbol.endsWith("USDC")
        ? symbol.replace("USDC", "-USDC")
        : symbol.replace("USDT", "-USDT"); // legacy fallback
    const closeSide = direction === "LONG" ? "SELL" : "BUY";
    // Hedge mode: close by specifying closeSide + positionSide — do NOT send reduceOnly
    const result = await placeOrder({
      symbol: bingxSymbol,
      side: closeSide,
      positionSide: direction,
      quantity: parseFloat(size),
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trigger a manual monitor check (updates unrealized P&L)
app.post("/api/positions/refresh", async (_req, res) => {
  try {
    const actions = await monitorOnce();
    res.json({ success: true, actions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Last Scan Summary (for "no signal" dashboard panel) ────────
// Returns the results of the most recent scanner run, including
// which setups were evaluated and why none triggered (if applicable).
app.get("/api/signals/last-scan", (_req, res) => {
  // Always prefer the on-disk file if it exists — it reflects the last
  // real scan regardless of whether the scanner ran in this process or not.
  const scanFile = resolve(__rootDir, "data/last-scan.json");
  if (existsSync(scanFile)) {
    try {
      const saved = JSON.parse(readFileSync(scanFile, "utf8"));
      // If the in-memory summary is newer, use that instead
      const memNewer = lastScanSummary.runAt &&
        new Date(lastScanSummary.runAt) > new Date(saved.runAt ?? 0);
      return res.json(memNewer ? lastScanSummary : saved);
    } catch {
      // File corrupt — fall through to in-memory or empty
    }
  }

  // No file — use in-memory if available
  if (lastScanSummary.runAt) {
    return res.json(lastScanSummary);
  }

  return res.json({
    runAt: null,
    message: "Nenhum scan executado ainda. Execute: npm run scan",
    results: [],
  });
});

// ── Analytics ──────────────────────────────────────────────────
app.get("/api/stats", (_req, res) => {
  res.json(getStats());
});

app.get("/api/equity", (req, res) => {
  const days = parseInt(req.query.days ?? "30");
  res.json(getSnapshots(days));
});

// ── Bot Errors (surfaced as dashboard banner) ──────────────────
app.get("/api/errors", (_req, res) => {
  res.json({
    hasActive: hasActiveErrors(),
    errors:    getRecentErrors(20),
  });
});

app.post("/api/errors/dismiss", (_req, res) => {
  dismissErrors();
  res.json({ success: true });
});

// ── Daily Risk Status ──────────────────────────────────────────
app.get("/api/risk/daily", (_req, res) => {
  const limitPct        = STRATEGY.DAILY_RISK_PCT ?? 0.005; // 0.5%
  const pnl             = getDailyPnl();
  const profit          = getDailyProfit();
  const limited         = isDailyLimitReached(config.capitalUsdt, limitPct);
  const profitTarget    = STRATEGY.DAILY_PROFIT_TARGET ?? 0;
  const profitReference = STRATEGY.DAILY_PROFIT_REFERENCE ?? 0;
  const targetHit       = isDailyTargetReached(profitTarget);
  const limitAmount     = parseFloat((config.capitalUsdt * limitPct).toFixed(2));
  const usagePct        = limitAmount > 0 ? Math.min(100, Math.abs(Math.min(0, pnl)) / limitAmount * 100) : 0;
  res.json({
    dailyPnl:        parseFloat(pnl.toFixed(2)),
    dailyProfit:     parseFloat(profit.toFixed(2)),
    capital:         config.capitalUsdt,
    limitPct,
    limitAmount,
    usagePct:        parseFloat(usagePct.toFixed(1)),
    limited,
    profitTarget,
    profitReference,
    targetHit,
  });
});

// ── Monthly Goal Progress ──────────────────────────────────────
// Retorna progresso do mês vs piso de $100.
app.get("/api/stats/goal", (_req, res) => {
  const floor   = STRATEGY.MONTHLY_PROFIT_FLOOR ?? 100;
  const monthly = getMonthlyPnl();
  const weekly  = getWeeklyPnl();

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth  = now.getDate();
  const expectedPace = (floor / daysInMonth) * dayOfMonth;
  const paceStatus  = monthly.pnl >= expectedPace ? "ON_TRACK"
                    : monthly.pnl >= expectedPace * 0.5 ? "BEHIND"
                    : "AT_RISK";

  res.json({
    floor,
    monthlyPnl:    monthly.pnl,
    weeklyPnl:     weekly.pnl,
    tradeCount:    monthly.tradeCount,
    winCount:      monthly.winCount,
    lossCount:     monthly.lossCount,
    winRate:       monthly.winRate,
    progressPct:   parseFloat(((monthly.pnl / floor) * 100).toFixed(1)),
    reached:       monthly.pnl >= floor,
    expectedPace:  parseFloat(expectedPace.toFixed(2)),
    paceStatus,
    daysInMonth,
    dayOfMonth,
    daysRemaining: daysInMonth - dayOfMonth,
    firstDay:      monthly.firstDay,
    lastDay:       monthly.lastDay,
  });
});

// ── Daily P&L Series (barras do gráfico) ──────────────────────
app.get("/api/stats/daily-series", (req, res) => {
  const days = parseInt(req.query.days ?? "30");
  res.json(getDailyPnlSeries(days));
});

// ── Monthly P&L Series ──────────────────────────────────────────
app.get("/api/stats/monthly-series", (req, res) => {
  const months = parseInt(req.query.months ?? "12");
  res.json(getMonthlyPnlSeries(months));
});

// ── Performance por Setup ──────────────────────────────────────
app.get("/api/stats/by-setup", (_req, res) => {
  res.json(getStatsBySetup());
});

// ── Performance por Símbolo ────────────────────────────────────
app.get("/api/stats/by-symbol", (_req, res) => {
  res.json(getStatsBySymbol());
});

// ── Drawdown Series ────────────────────────────────────────────
app.get("/api/stats/drawdown", (req, res) => {
  const days = parseInt(req.query.days ?? "90");
  res.json(getDrawdownSeries(days));
});

// ── Close Reason Breakdown (TP1, TP2, TP3, SL, MANUAL) ─────────
app.get("/api/stats/close-reasons", (_req, res) => {
  res.json(getCloseReasonBreakdown());
});

// ── STH Realized Price Monitor ────────────────────────────────
app.get("/api/sth-monitor", async (_req, res) => {
  try {
    // Fetch current BTC price for proximity calculation
    let btcPrice = null;
    try { btcPrice = await getPrice("BTC-USDT"); } catch { /* offline */ }

    const sth     = await getSTHRealizedPrice(btcPrice);
    const history = getSTHProximityHistory();
    const cfg     = SETUPS?.STH_REALIZED_PRICE ?? {};

    res.json({
      sthPrice:        sth.price,
      source:          sth.source,
      btcPrice,
      touchProximityPct: sth.touchProximityPct,
      priceAbove:      sth.priceAbove,
      isNearLine:      sth.isNearLine,
      isConverging:    sth.isConverging,
      proximityDelta:  sth.proximityDelta,
      convergenceStatus: sth.convergenceStatus,
      historyLength:   sth.historyLength,
      touchThresholdPct: (cfg.touch_pct ?? 0.03) * 100,
      leverage:        cfg.leverage ?? 20,
      slPct:           (cfg.sl_pct ?? 0.10) * 100,
      history: history.slice(-10).map((h) => ({
        pct:        h.pct,
        priceAbove: h.priceAbove,
        ts:         new Date(h.ts).toISOString(),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Price Level Monitors ───────────────────────────────────────
app.get("/api/monitors", (_req, res) => {
  try {
    res.json({ monitors: getMonitorStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Market Metrics ─────────────────────────────────────────────
// Cached snapshot updated every 5 min by the scanner.
// Returns stale data + triggers background refresh if cache is old.
app.get("/api/market-metrics", (_req, res) => {
  res.json(getMarketMetrics());
});

// Force an immediate refresh (useful after server restart)
app.post("/api/market-metrics/refresh", async (_req, res) => {
  try {
    const metrics = await refreshMarketMetrics(null);
    res.json({ success: true, metrics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Trendlines (LTA/LTB) ───────────────────────────────────────
// Módulo isolado, não integrado ao scoring ainda.
// Serve pro dashboard visualizar as linhas e validar visualmente
// antes de plugar em signals.js.
//
// Query params:
//   timeframe=240 (default H4). Aceita: 15,30,60,240,D,W
//
// Cache de 60s por (symbol, timeframe) pra não bater API a cada refresh.
const _trendlinesCache = new Map(); // `${sym}|${tf}` → { data, fetchedAt }
const TRENDLINES_TTL_MS = 60 * 1000;

app.get("/api/trendlines/:symbol", async (req, res) => {
  try {
    const symbol    = req.params.symbol;
    const timeframe = req.query.timeframe ?? "240";
    const cacheKey  = `${symbol}|${timeframe}`;
    const noCache   = req.query.fresh === "1";

    if (!noCache) {
      const cached = _trendlinesCache.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < TRENDLINES_TTL_MS) {
        return res.json({ ...cached.data, cached: true, cachedAgeMs: Date.now() - cached.fetchedAt });
      }
    }

    const adapter = createBinanceAdapter();
    const data    = await analyzeTrendlines(symbol, adapter, { timeframe });
    _trendlinesCache.set(cacheKey, { data, fetchedAt: Date.now() });
    res.json({ ...data, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message, symbol: req.params.symbol });
  }
});

// ── Admin ──────────────────────────────────────────────────────
// DELETE all closed/stopped trade records (keeps open positions).
// Used by the dashboard "Clear History" button.
app.post("/api/admin/clear-history", (_req, res) => {
  try {
    const deleted = clearClosedTrades();
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Audit open BingX positions for missing SL/TP and apply them.
app.post("/api/admin/repair-sl-tp", async (_req, res) => {
  try {
    const report = await repairMissingSLTP();
    res.json({ success: true, ...report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Strategy rules (read-only) ─────────────────────────────────
// Serves the SETUPS + STRATEGY config to the dashboard for display.
app.get("/api/strategy", (_req, res) => {
  res.json({ setups: SETUPS, strategy: STRATEGY });
});

// ── Knowledge Base ─────────────────────────────────────────────
// Persistent markdown file for trading knowledge.
// Dashboard reads it; Claude Code appends to it via POST.

app.get("/api/knowledge-base", (_req, res) => {
  try {
    const content = existsSync(KB_PATH)
      ? readFileSync(KB_PATH, "utf8")
      : "# Base de Conhecimento\n\nNenhuma entrada ainda.\n";
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/knowledge-base", (req, res) => {
  try {
    const { title, content } = req.body ?? {};
    if (!title || !content) {
      return res.status(400).json({ error: "title e content são obrigatórios" });
    }
    const existing = existsSync(KB_PATH)
      ? readFileSync(KB_PATH, "utf8")
      : "# Base de Conhecimento\n\n";
    const date    = new Date().toLocaleDateString("pt-BR");
    const entry   = `\n---\n## ${title}\n*Adicionado em ${date}*\n\n${content}\n`;
    writeFileSync(KB_PATH, existing + entry, "utf8");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Bootstrap ───────────────────────────────────────────────────
const PORT = parseInt(process.env.API_PORT ?? "3001", 10);
app.listen(PORT, () => {
  console.log(`[API] Server listening on http://localhost:${PORT}`);
  console.log(`[API] Mode: ${config.paperTrade ? "PAPER" : "LIVE"}  |  Capital: $${config.capitalUsdt}`);
});
