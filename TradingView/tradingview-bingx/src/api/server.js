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
} from "../storage/trades.js";
import { executeSignal, closeTrade } from "../bot/executor.js";
import { monitorOnce } from "../bot/monitor.js";
import { getBalance, getPrice, getPositions, getOpenOrders, placeOrder } from "../exchanges/bingx.js";
import { getCoinMPositions, getCoinMOpenOrders, getCoinMBalance, isCoinMEnabled } from "../exchanges/bingx_coinm.js";
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
    const priceSymbols = ["BTC-USDT", "ETH-USDT", "XAU-USDT"];
    const priceKeys    = ["BTCUSDT",  "ETHUSDT",  "XAUUSDT"];

    const [stats, snapshots, openTrades, ...priceResults] =
      await Promise.allSettled([
        Promise.resolve(getStats()),
        Promise.resolve(getSnapshots(30)),
        Promise.resolve(getOpenTrades()),
        ...priceSymbols.map((s) => getPrice(s)),
      ]);

    // USDT-M balance
    let balance = { available: config.capitalUsdt, total: config.capitalUsdt, unrealizedPnl: 0 };
    try { balance = await getBalance(); } catch { /* paper mode */ }

    // Coin-M balance — always try; silently skipped if API keys are not configured.
    // COINM_ENABLED only gates new order placement, not reading.
    let coinMBalance = null;
    try { coinMBalance = await getCoinMBalance(); } catch { /* API not configured or unavailable */ }

    const prices = {};
    priceKeys.forEach((key, i) => {
      prices[key] = priceResults[i].status === "fulfilled" ? priceResults[i].value : null;
    });

    res.json({
      balance,
      coinMBalance,
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

// ── Shared helper: fetch + upsert all live positions (USDT-M + Coin-M) ──
// COINM_ENABLED only gates new order placement — reading is always allowed.
async function syncAllPositions() {
  const [usdtPosRes, coinmPosRes, usdtOrdRes, coinmOrdRes] = await Promise.allSettled([
    getPositions(),
    getCoinMPositions(),
    getOpenOrders(),        // all pending SL/TP orders for USDT-M
    getCoinMOpenOrders(),   // all pending SL/TP orders for Coin-M
  ]);

  if (coinmPosRes.status === "rejected") {
    console.warn(`[SYNC] Coin-M API unavailable: ${coinmPosRes.reason?.message ?? "unknown error"}`);
  }

  const usdtOrders  = usdtOrdRes.status  === "fulfilled" ? usdtOrdRes.value  : [];
  const coinmOrders = coinmOrdRes.status === "fulfilled" ? coinmOrdRes.value : [];

  const allPositions = [
    ...(usdtPosRes.status  === "fulfilled" ? usdtPosRes.value  : []),
    ...(coinmPosRes.status === "fulfilled" ? coinmPosRes.value : []),
  ];

  const synced = [];
  for (const pos of allPositions) {
    const market  = pos.market ?? "USDT-M";
    const orders  = market === "COIN-M" ? coinmOrders : usdtOrders;
    const slTp    = extractSlTp(orders, pos.symbol, pos.side);

    if (pos.entryPrice === 0) {
      console.warn(`[SYNC] ${market} ${pos.side} ${pos.symbol} — BingX returned entryPrice=0 (check /api/coinm/status for raw field names)`);
    }

    const localId = upsertBingXPosition({ ...pos, ...slTp });
    synced.push({ symbol: pos.symbol, side: pos.side, market, localId });
  }

  // ── Auto-close positions no longer live on BingX ──────────────
  // Build a set of live position keys (DB symbol format + direction).
  // Only auto-close if the relevant market's API call succeeded —
  // never close positions just because the API temporarily failed.
  const liveKeys = new Set(
    allPositions.map((p) => `${p.symbol.replace("-", "")}:${p.side}`)
  );

  const openTrades = getOpenTrades();

  // 1. EXTERNAL trades (created by sync from BingX positions opened manually)
  for (const t of openTrades.filter((t) => t.trade_type === "EXTERNAL")) {
    const isCoinM  = !t.symbol.endsWith("USDT");
    const marketOk = isCoinM
      ? coinmPosRes.status === "fulfilled"
      : usdtPosRes.status === "fulfilled";
    if (marketOk && !liveKeys.has(`${t.symbol}:${t.direction}`)) {
      closeExternalTrade(t.id);
      console.log(`[SYNC] Auto-closed external #${t.id} ${t.direction} ${t.symbol} — not on BingX`);
    }
  }

  // 2. Bot-created trades (scanner/executor opened them) — close if no longer on BingX.
  //    This handles SL/TP hits that monitor.js may have missed.
  for (const t of openTrades.filter((t) => t.trade_type !== "EXTERNAL")) {
    const isCoinM  = !t.symbol.endsWith("USDT");
    const marketOk = isCoinM
      ? coinmPosRes.status === "fulfilled"
      : usdtPosRes.status === "fulfilled";
    if (marketOk && !liveKeys.has(`${t.symbol}:${t.direction}`)) {
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
 * @param {string}   symbol   - BingX format: "BTC-USDT" or "BTC-USD"
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

// Sync live BingX positions (USDT-M + Coin-M) into local DB
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
    const bingxSymbol = symbol.includes("-") ? symbol : symbol.replace("USDT", "-USDT");
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

// ── Coin-M Diagnostics ─────────────────────────────────────────
// GET /api/coinm/status — shows whether Coin-M API is reachable and
// what positions/balance are returned. Use this to debug API key
// permission issues without restarting the server.
app.get("/api/coinm/status", async (_req, res) => {
  const [balRes, posRes, rawPosRes] = await Promise.allSettled([
    getCoinMBalance(),
    getCoinMPositions(),
    // Raw positions — shows actual API field names for debugging
    (async () => {
      const { createHmac } = await import("crypto");
      const https = await import("https");
      // Re-use same auth logic inline for raw dump
      return new Promise((resolve) => {
        const ts  = Date.now().toString();
        const key = config.bingx.apiKey;
        const sec = config.bingx.secretKey;
        if (!key || !sec) return resolve({ error: "API keys not configured" });
        const params = { timestamp: ts };
        const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
        const sig = createHmac("sha256", sec).update(sorted).digest("hex");
        const qs  = `timestamp=${ts}&signature=${sig}`;
        const opts = {
          hostname: "open-api.bingx.com",
          path:     `/openApi/cswap/v1/user/positions?${qs}`,
          method:   "GET",
          headers:  { "X-BX-APIKEY": key, "Content-Type": "application/json" },
        };
        const req = https.default.request(opts, (r) => {
          let d = "";
          r.on("data", (c) => (d += c));
          r.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d.slice(0, 500) }); } });
        });
        req.on("error", (e) => resolve({ error: e.message }));
        req.end();
      });
    })(),
  ]);
  res.json({
    enabled:      isCoinMEnabled(),
    balance:      balRes.status  === "fulfilled" ? balRes.value  : { error: balRes.reason?.message },
    positions:    posRes.status  === "fulfilled" ? posRes.value  : { error: posRes.reason?.message },
    rawPositions: rawPosRes.status === "fulfilled" ? rawPosRes.value : { error: rawPosRes.reason?.message },
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
  const pnl          = getDailyPnl();
  const profit       = getDailyProfit();
  const limited      = isDailyLimitReached(config.capitalUsdt);
  const profitTarget    = STRATEGY.DAILY_PROFIT_TARGET ?? 0;       // hard stop (0 = off)
  const profitReference = STRATEGY.DAILY_PROFIT_REFERENCE ?? 0;   // display-only goal
  const targetHit       = isDailyTargetReached(profitTarget);      // always false when 0
  res.json({
    dailyPnl:        parseFloat(pnl.toFixed(2)),
    dailyProfit:     parseFloat(profit.toFixed(2)),
    capital:         config.capitalUsdt,
    limitPct:        0.01,
    limitAmount:     parseFloat((config.capitalUsdt * 0.01).toFixed(2)),
    limited,
    profitTarget,
    profitReference,  // $100 — shown in dashboard as the daily goal bar
    targetHit,
  });
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

// ── Start ──────────────────────────────────────────────────────
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  app.listen(config.apiPort, () => {
    console.log(`API server running at http://localhost:${config.apiPort}`);
    console.log(`Mode: ${config.paperTrade ? "PAPER TRADE" : "LIVE"}`);
    console.log(`Dashboard: http://localhost:${config.dashboardPort}`);
  });

  // ── Signal expiry — runs every 30s ────────────────────────────
  // Removes pending signals that are too old, have their SL already
  // breached, or where the entry zone has been missed (price moved
  // past the first entry without filling the LIMIT orders).
  const runExpiryCheck = async () => {
    try {
      const expired = await expireStalePendingSignals();
      if (expired.length > 0) {
        console.log(
          `[EXPIRY] Removed ${expired.length} stale signal(s):\n` +
          expired.map((e) => `  #${e.id} ${e.direction} ${e.symbol} — ${e.reason}`).join("\n")
        );
      }
    } catch (err) {
      console.warn(`[EXPIRY] Check failed: ${err.message}`);
    }
  };

  // Run once immediately on startup (clears any signals left from a previous session),
  // then every 30 seconds.
  runExpiryCheck();
  setInterval(runExpiryCheck, 30_000);

  // ── Position sync — runs every 30s ────────────────────────────
  // Keeps Coin-M (and USDT-M) positions in the local DB up-to-date
  // regardless of whether the dashboard is open. Silently skipped
  // if BingX API keys are not configured (paper trade mode).
  const runPositionSync = async () => {
    try {
      const synced = await syncAllPositions();
      const coinm  = synced.filter((p) => p.market === "COIN-M");
      if (coinm.length > 0) {
        console.log(
          `[SYNC] Coin-M positions synced: ${coinm.map((p) => `${p.side} ${p.symbol} (id=${p.localId})`).join(", ")}`
        );
      }
    } catch (err) {
      console.warn(`[SYNC] Position sync error: ${err.message}`);
    }
  };

  runPositionSync();
  setInterval(runPositionSync, 30_000);
}

export default app;
