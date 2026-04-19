// ─────────────────────────────────────────────────────────────────
//  Scanner — Fully Automated Trading Bot
//  Runs every 30s (with lock to prevent overlap).
//  When a setup fires it auto-executes immediately — no manual
//  approval required. Daily 1% risk cap enforced before each trade.
// ─────────────────────────────────────────────────────────────────

import { fileURLToPath } from "url";
import { analyzeTechnical, createMcpAdapter } from "../analysis/technical.js";
import { analyzeMacro } from "../analysis/macro.js";
import { generateSignal } from "../strategy/signals.js";
import { checkPriceMonitors } from "../analysis/price_monitors.js";
import { refreshMarketMetrics } from "../analysis/market_metrics.js";
import {
  saveSignal, updateSignalStatus,
  upsertBingXPosition, saveSnapshot,
  isDailyLimitReached, getDailyPnl,
  isDailyTargetReached, getDailyProfit,
} from "../storage/trades.js";
import { getBalance, getPositions } from "../exchanges/bingx.js";
import { getCoinMPositions, openCoinMHedge, isCoinMEnabled } from "../exchanges/bingx_coinm.js";
import { executeSignal } from "./executor.js";
import config, { refreshCapital } from "../config/index.js";
import { STRATEGY } from "../config/strategy.js";
import { logError, logWarn, logInfo } from "./error_tracker.js";

const SCAN_INTERVAL_MS = 300_000; // 5 minutes
let _isScanning = false;          // lock: skip if previous run still active

// ── Shared last-scan summary (exposed via API) ─────────────────
export const lastScanSummary = {
  runAt:          null,
  capital:        null,
  dailyPnl:       null,
  dailyLimited:   false,
  dailyTargetHit: false,
  symbols:        [],
  results:        [],
  macroContext:   null,
};

// ── Main Scan ──────────────────────────────────────────────────

async function runScan() {
  const startTime = Date.now();
  const ts = new Date().toISOString();
  console.log(`\n[${ts}] Scanner starting...`);

  const results = [];

  // ── 1. Refresh live capital ────────────────────────────────────
  const liveCapital = await refreshCapital();

  // ── 2. Daily risk limit check ──────────────────────────────────
  const dailyPnl   = getDailyPnl();
  const dayLimited = isDailyLimitReached(liveCapital, STRATEGY.DAILY_RISK_PCT);

  if (dayLimited) {
    console.log(
      `[SCANNER] Daily risk limit reached — P&L today: $${dailyPnl.toFixed(2)} / ` +
      `limit: -$${(liveCapital * STRATEGY.DAILY_RISK_PCT).toFixed(2)}. ` +
      `No new trades until tomorrow.`
    );
    logInfo("SCANNER", "Daily risk limit reached — trading paused for today", {
      dailyPnl: dailyPnl.toFixed(2),
      limit: (liveCapital * STRATEGY.DAILY_RISK_PCT).toFixed(2),
    });
    lastScanSummary.runAt        = ts;
    lastScanSummary.dailyPnl     = dailyPnl;
    lastScanSummary.dailyLimited = true;
    return [];
  }

  // ── 2b. Daily profit target check ─────────────────────────────
  const profitTarget = STRATEGY.DAILY_PROFIT_TARGET ?? 0;
  if (profitTarget > 0 && isDailyTargetReached(profitTarget)) {
    const dailyProfit = getDailyProfit();
    console.log(
      `[SCANNER] Daily profit target reached — Profit today: $${dailyProfit.toFixed(2)} / ` +
      `target: $${profitTarget.toFixed(2)}. No new trades until tomorrow.`
    );
    logInfo("SCANNER", "Daily profit target reached — trading paused for today", {
      dailyProfit: dailyProfit.toFixed(2),
      target: profitTarget.toFixed(2),
    });
    lastScanSummary.runAt          = ts;
    lastScanSummary.dailyPnl       = dailyPnl;
    lastScanSummary.dailyLimited   = false;
    lastScanSummary.dailyTargetHit = true;
    return [];
  }
  lastScanSummary.dailyTargetHit = false;
  lastScanSummary.dailyLimited   = false;
  lastScanSummary.dailyPnl       = dailyPnl;

  // ── 3. Sync live BingX positions into local DB ─────────────────
  try {
    const [usdtPos, coinmPos] = await Promise.allSettled([
      getPositions(),
      getCoinMPositions(),
    ]);
    const allLive = [
      ...(usdtPos.status  === "fulfilled" ? usdtPos.value  : []),
      ...(coinmPos.status === "fulfilled" ? coinmPos.value : []),
    ];
    for (const pos of allLive) upsertBingXPosition(pos);
  } catch { /* paper mode or no API key */ }

  // ── 4. Connect to TradingView + run analysis ───────────────────
  try {
    const mcp   = await createMcpAdapter();
    const macro = await analyzeMacro();

    // ── Refresh market metrics (BTC dominance, funding, realized price, CVDD, STH) ──
    // Runs every scanner cycle (5 min). Fires and forgets — never blocks the main scan.
    refreshMarketMetrics(null).catch((err) =>
      console.warn(`[SCANNER] Market metrics refresh failed: ${err.message}`)
    );

    console.log(
      `[SCANNER] Capital: $${liveCapital.toFixed(2)} | ` +
      `Daily P&L: $${dailyPnl.toFixed(2)} | ` +
      `Fear/Greed: ${macro.fearGreed.value} (${macro.fearGreed.label})`
    );

    lastScanSummary.macroContext = {
      fearGreed: macro.fearGreed,
      bias:      macro.context?.overallBias,
      hasHighRisk: macro.hasHighRisk,
      warnings:  macro.riskWarnings?.filter((w) => w.severity === "high").map((w) => w.type) ?? [],
    };

    if (macro.hasHighRisk) {
      logWarn("SCANNER", "High-risk macro event active", {
        events: lastScanSummary.macroContext.warnings,
      });
    }

    // ── 5. Analyze each symbol ─────────────────────────────────────
    for (const symbol of STRATEGY.SYMBOLS) {
      const symCfg = STRATEGY.SYMBOL_CONFIG?.[symbol];
      if (symCfg && !symCfg.enabled) {
        results.push({ symbol, signal: { status: "DISABLED", direction: null, score: 0 } });
        continue;
      }

      const tvSymbol = STRATEGY.SYMBOL_TV_MAP?.[symbol] ?? symbol;
      console.log(`[SCANNER] Analyzing ${symbol}...`);

      try {
        const technical = await analyzeTechnical(tvSymbol, mcp);
        technical.symbol = symbol;

        const signal = await generateSignal(symbol, technical, macro);

        if (!signal.direction || signal.status === "BELOW_THRESHOLD") {
          console.log(`  → No setup: ${signal.rationale?.[0] ?? "below threshold"}`);
          results.push({ symbol, signal });
          continue;
        }

        // Valid setup — save and auto-execute
        console.log(
          `  ✦ SIGNAL: ${signal.direction} ${symbol} | ` +
          `Score: ${signal.score} | ` +
          `Entry: $${signal.entry?.toLocaleString()} | ` +
          `SL: $${signal.sl?.toLocaleString()} | ` +
          `TP1: $${signal.tp1?.toLocaleString()}`
        );

        const signalId = saveSignal(signal);

        // Re-check daily limit (another symbol in this cycle may have filled a trade)
        if (isDailyLimitReached(liveCapital, STRATEGY.DAILY_RISK_PCT)) {
          updateSignalStatus(signalId, "REJECTED");
          console.log(`  → Skipped: daily risk limit reached mid-scan`);
          results.push({ symbol, signalId, signal, skipped: "daily_limit" });
          continue;
        }

        // ── Auto-execute ──────────────────────────────────────────
        console.log(`  → Auto-executing signal #${signalId}...`);
        const execResult = await executeSignal(signalId);

        if (execResult.success) {
          console.log(`  ✓ Trade #${execResult.tradeId} opened`);
          logInfo("EXECUTOR", `Auto-executed ${signal.direction} ${symbol}`, {
            tradeId:  execResult.tradeId,
            signalId, entry: signal.entry, sl: signal.sl,
          });

          // ── Coin-M SHORT hedge (BTC bearish setup only) ───────────
          if (
            symbol === "BTCUSDT" &&
            signal.direction === "SHORT" &&
            isCoinMEnabled()
          ) {
            try {
              const hedge = await openCoinMHedge(signal.price ?? signal.entry);
              console.log(
                `  ✓ Coin-M hedge opened: ${hedge.contracts} contract(s) @ ~$${hedge.price ?? signal.entry}`
              );
              logInfo("EXECUTOR", "Coin-M hedge opened alongside BTCUSDT SHORT", {
                contracts: hedge.contracts,
                paper: hedge.paper,
              });
            } catch (hedgeErr) {
              logWarn("EXECUTOR", `Coin-M hedge failed: ${hedgeErr.message}`, { symbol });
              console.warn(`  ⚠ Coin-M hedge failed: ${hedgeErr.message}`);
            }
          }

          results.push({ symbol, signalId, tradeId: execResult.tradeId, signal });
        } else {
          console.warn(`  ✗ Execution failed: ${execResult.error}`);
          logError("error", "EXECUTOR", `Auto-execution failed for ${symbol}`, {
            signalId, error: execResult.error, reasons: execResult.reasons,
          });
          results.push({ symbol, signalId, signal, execError: execResult.error });
        }

        // ── Price Level Monitors ────────────────────────────────────────
        // Check user-defined price monitors (monitors.json) for this symbol.
        // These are multi-stage state machines independent of the setup engine.
        try {
          const monitorSignals = checkPriceMonitors(symbol, technical, liveCapital);
          for (const monSig of monitorSignals) {
            const monSignalId = saveSignal(monSig);

            // Re-check daily limit before executing each monitor signal
            if (isDailyLimitReached(liveCapital, STRATEGY.DAILY_RISK_PCT)) {
              updateSignalStatus(monSignalId, "REJECTED");
              console.log(`  [MONITOR] → Skipped ${monSig.setup_id}: daily risk limit active`);
              continue;
            }

            console.log(
              `  [MONITOR] Auto-executing ${monSig.setup_id} — ` +
              `${monSig.direction} ${symbol} @ $${monSig.entry}`
            );
            const execResult = await executeSignal(monSignalId);

            if (execResult.success) {
              console.log(`  [MONITOR] ✓ Trade #${execResult.tradeId} opened via monitor`);
              logInfo("EXECUTOR", `Monitor signal executed: ${monSig.setup_id}`, {
                tradeId: execResult.tradeId, signalId: monSignalId,
                entry: monSig.entry, sl: monSig.sl,
              });
            } else {
              console.warn(`  [MONITOR] ✗ Execution failed: ${execResult.error}`);
              logError("error", "EXECUTOR", `Monitor execution failed: ${monSig.setup_id}`, {
                signalId: monSignalId, error: execResult.error,
              });
            }
          }
        } catch (monErr) {
          console.warn(`  [MONITOR] Error checking monitors for ${symbol}: ${monErr.message}`);
        }

      } catch (symbolErr) {
        console.error(`  ERROR scanning ${symbol}: ${symbolErr.message}`);
        logError("error", "SCANNER", `Scan failed for ${symbol}: ${symbolErr.message}`, {
          symbol, stack: symbolErr.stack?.slice(0, 300),
        });
        results.push({ symbol, error: symbolErr.message });
      }
    }

    // Save daily equity snapshot once per scan
    try {
      const balance = await getBalance();
      saveSnapshot(balance.total || liveCapital);
    } catch {
      saveSnapshot(liveCapital);
    }

  } catch (err) {
    console.error(`[SCANNER] Scan failed: ${err.message}`);
    logError("error", "SCANNER", `Scan cycle failed: ${err.message}`, {
      stack: err.stack?.slice(0, 300),
    });
    if (err.message?.includes("TradingView") || err.message?.includes("CDP")) {
      logError("error", "SCANNER", "TradingView Desktop connection lost — restart required", {
        hint: "Run: scripts\\launch_tv_debug.bat",
      });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[SCANNER] Scan complete in ${elapsed}s`);

  // Update summary for dashboard /api/signals/last-scan
  lastScanSummary.runAt   = ts;
  lastScanSummary.capital = liveCapital;
  lastScanSummary.symbols = STRATEGY.SYMBOLS;
  lastScanSummary.results = results.map((r) => ({
    symbol:     r.symbol,
    status:     r.signal?.status ?? (r.error ? "ERROR" : "BELOW_THRESHOLD"),
    setup_name: r.signal?.setup_name ?? null,
    score:      r.signal?.score ?? 0,
    direction:  r.signal?.direction ?? null,
    tradeId:    r.tradeId ?? null,
    rationale:  r.signal?.rationale ?? (r.error ? [r.error] : []),
  }));

  return results;
}

// ── Non-overlapping wrapper ─────────────────────────────────────

async function runScanWithLock() {
  if (_isScanning) {
    // Previous run still active — skip this tick to avoid overlap
    return;
  }
  _isScanning = true;
  try {
    await runScan();
  } catch (err) {
    console.error(`[SCANNER] Unhandled error: ${err.message}`);
    logError("error", "SCANNER", `Unhandled scanner error: ${err.message}`);
  } finally {
    _isScanning = false;
  }
}

// ── Entry Point ────────────────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const runOnce = process.argv.includes("--once");

  if (runOnce) {
    await runScanWithLock();
    process.exit(0);
  } else {
    console.log("BTC/ETH Trader — Automated Scanner");
    console.log(`Interval : every ${SCAN_INTERVAL_MS / 1000}s / ${SCAN_INTERVAL_MS / 60000}min (skips if previous run active)`);
    console.log(`Mode     : ${config.paperTrade ? "PAPER TRADE" : "LIVE"}`);
    console.log(`Symbols  : ${STRATEGY.SYMBOLS.join(", ")}\n`);

    // Run immediately, then on interval
    await runScanWithLock();
    setInterval(runScanWithLock, SCAN_INTERVAL_MS);

    console.log("\nScanner running. Press Ctrl+C to stop.");
  }
}

export { runScan, runScanWithLock };
