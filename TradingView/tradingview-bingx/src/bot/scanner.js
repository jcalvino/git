// ─────────────────────────────────────────────────────────────────
//  Scanner — Fully Automated Trading Bot
//  Runs every 30s (with lock to prevent overlap).
//  When a setup fires it auto-executes immediately — no manual
//  approval required. Daily 0.5% loss cap enforced before each trade.
// ─────────────────────────────────────────────────────────────────

import { fileURLToPath } from "url";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { analyzeTechnical, createBinanceAdapter } from "../analysis/technical.js";
import { analyzeMacro } from "../analysis/macro.js";
import { generateSignal } from "../strategy/signals.js";
import { checkPriceMonitors } from "../analysis/price_monitors.js";
import { refreshMarketMetrics } from "../analysis/market_metrics.js";
import {
  saveSignal, updateSignalStatus,
  upsertBingXPosition, saveSnapshot,
  isDailyLimitReached, getDailyPnl,
  isDailyTargetReached, getDailyProfit,
  findRecentActiveSignal,
} from "../storage/trades.js";

// Janela de dedup: se existe sinal ativo (PENDING_APPROVAL/APPROVED)
// do mesmo symbol+direction nas últimas N horas, novo sinal é pulado.
// 4h = TF principal dos setups. Setup não muda em 5min (intervalo do scan).
const SIGNAL_DEDUP_HOURS = 4;
import { getBalance, getPositions } from "../exchanges/bingx.js";
import { executeSignal } from "./executor.js";
import config, { refreshCapital } from "../config/index.js";
import { STRATEGY } from "../config/strategy.js";
import { logError, logWarn, logInfo } from "./error_tracker.js";
import { notify } from "./notifier.js";

const SCAN_INTERVAL_MS = 300_000; // 5 minutes
let _isScanning = false;          // lock: skip if previous run still active

// ── Shared last-scan summary (exposed via API) ─────────────────
export const lastScanSummary = {
  runAt: null,
  capital: null,
  dailyPnl: null,
  dailyLimited: false,
  dailyTargetHit: false,
  symbols: [],
  results: [],
  macroContext: null,
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
  const dailyPnl = getDailyPnl();
  const dayLimited = isDailyLimitReached(liveCapital, STRATEGY.DAILY_RISK_PCT);

  if (dayLimited) {
    console.log(
      `[SCANNER] Daily risk limit reached — P&L today: $${dailyPnl.toFixed(2)} / ` +
      `limit: -$${(liveCapital * STRATEGY.DAILY_RISK_PCT).toFixed(2)}. ` +
      `Analysis continues; execution blocked in executor.`
    );
    logInfo("SCANNER", "Daily risk limit reached — analysis continues, execution blocked", {
      dailyPnl: dailyPnl.toFixed(2),
      limit: (liveCapital * STRATEGY.DAILY_RISK_PCT).toFixed(2),
    });
  }

  // ── 2b. Daily profit target check ─────────────────────────────
  const profitTarget = STRATEGY.DAILY_PROFIT_TARGET ?? 0;
  const dayTargetHit = profitTarget > 0 && isDailyTargetReached(profitTarget);
  if (dayTargetHit) {
    const dailyProfit = getDailyProfit();
    console.log(
      `[SCANNER] Daily profit target reached — Profit today: $${dailyProfit.toFixed(2)} / ` +
      `target: $${profitTarget.toFixed(2)}. Analysis continues; execution blocked in executor.`
    );
    logInfo("SCANNER", "Daily profit target reached — analysis continues, execution blocked", {
      dailyProfit: dailyProfit.toFixed(2),
      target: profitTarget.toFixed(2),
    });
  }
  lastScanSummary.dailyTargetHit = dayTargetHit;
  lastScanSummary.dailyLimited   = dayLimited;
  lastScanSummary.dailyPnl       = dailyPnl;

  // ── 3. Sync live BingX USDC-M positions into local DB ──────────
  // Em PAPER_TRADE=true pulamos — caso contrário posições reais da
  // BingX (abertas manualmente ou em sessão live anterior) vazam pro
  // histórico local como trade_type=EXTERNAL e poluem o win rate do bot.
  // Para ingerir externos novamente basta PAPER_TRADE=false.
  if (!config.paperTrade) {
    try {
      const live = await getPositions();
      for (const pos of (live ?? [])) upsertBingXPosition(pos);
    } catch { /* no API key or request failed */ }
  }

  // ── 4. Fetch market data via Binance + run analysis ───────────
  try {
    const mcp = createBinanceAdapter();
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
      bias: macro.context?.overallBias,
      hasHighRisk: macro.hasHighRisk,
      warnings: macro.riskWarnings?.filter((w) => w.severity === "high").map((w) => w.type) ?? [],
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

      console.log(`[SCANNER] Analyzing ${symbol}...`);

      try {
        const technical = await analyzeTechnical(symbol, mcp).catch((err) => {
          if (err.code === "SYMBOL_PAUSED") {
            console.log(`  → ${symbol}: paused on BingX — skipping`);
            return null;
          }
          throw err;
        });
        if (!technical) {
          results.push({ symbol, signal: { status: "PAUSED", direction: null, score: 0 } });
          continue;
        }
        technical.symbol = symbol;

        const signal = await generateSignal(symbol, technical, macro);

        if (!signal.direction || signal.status === "BELOW_THRESHOLD") {
          console.log(`  → No setup: ${signal.rationale?.[0] ?? "below threshold"}`);
          // Breakdown (base + cada modifier) — fica logo abaixo, indentado
          const extras = (signal.rationale ?? []).slice(1);
          for (const line of extras) {
            if (line) console.log(`      · ${line}`);
          }

          // Persistência seletiva:
          // • status=BELOW_THRESHOLD com direction preenchida → setup triggerou
          //   mas não cruzou MIN_SCORE. Salvar pra backtest + watchlist no dash.
          // • direction=null → nada triggerou (_noSignal puro). Não salvar —
          //   evita poluir a tabela com ticks de silêncio.
          let rejectedId = null;
          if (signal.status === "BELOW_THRESHOLD" && signal.direction) {
            // Dedup: se já tem sinal ativo mesmo symbol+direction nas últimas 4h,
            // não salva BELOW_THRESHOLD também (evita inflar estatísticas contrafactuais)
            const dup = findRecentActiveSignal(signal.symbol, signal.direction, SIGNAL_DEDUP_HOURS);
            if (dup) {
              console.log(`      ↳ Watchlist skip: signal ativo #${dup.id} mesmo ${signal.direction} em ${signal.symbol} há <${SIGNAL_DEDUP_HOURS}h`);
            } else {
              try {
                rejectedId = saveSignal(signal);
                console.log(`      ↳ Watchlist signal #${rejectedId} salvo (${signal.setup_id})`);
              } catch (saveErr) {
                console.warn(`      ↳ Falha ao salvar watchlist signal: ${saveErr.message}`);
              }
            }
          }

          results.push({ symbol, signal, signalId: rejectedId });
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

        // Dedup guard: se já tem sinal ativo do mesmo symbol+direction nas últimas 4h,
        // pula pra evitar trades duplicados e ruído nas estatísticas. Fix do bug onde
        // scanner (roda cada 5min) gerava N sinais idênticos pro mesmo setup de H4.
        const dup = findRecentActiveSignal(signal.symbol, signal.direction, SIGNAL_DEDUP_HOURS);
        if (dup) {
          console.log(
            `  → Skipped: signal ativo #${dup.id} ${dup.status} ` +
            `(${signal.direction} ${symbol}) criado em ${dup.created_at} — ` +
            `dedup window ${SIGNAL_DEDUP_HOURS}h`
          );
          results.push({ symbol, signal, skipped: "dedup", dupSignalId: dup.id });
          continue;
        }

        const signalId = saveSignal(signal);

        // ── Telegram: alert user do sinal ANTES da execução ─────────
        // Fire-and-forget — se o executor falhar, pelo menos o alerta
        // já chegou no celular e você sabe que houve sinal.
        notify.signal({ ...signal, id: signalId }).catch(() => {});

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
            tradeId: execResult.tradeId,
            signalId, entry: signal.entry, sl: signal.sl,
          });

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
            notify.signal({ ...monSig, id: monSignalId }).catch(() => {});

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
    if (err.message?.includes("Binance") || err.message?.includes("fetch")) {
      logError("error", "SCANNER", "Binance API request failed — check network connectivity", {
        hint: "Verify api.binance.com is reachable",
      });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[SCANNER] Scan complete in ${elapsed}s`);

  // Update summary for dashboard /api/signals/last-scan
  lastScanSummary.runAt = ts;
  lastScanSummary.capital = liveCapital;
  lastScanSummary.symbols = STRATEGY.SYMBOLS;
  lastScanSummary.results = results.map((r) => ({
    symbol: r.symbol,
    status: r.signal?.status ?? (r.error ? "ERROR" : "BELOW_THRESHOLD"),
    setup_name: r.signal?.setup_name ?? null,
    score: r.signal?.score ?? 0,
    direction: r.signal?.direction ?? null,
    tradeId: r.tradeId ?? null,
    rationale: r.signal?.rationale ?? (r.error ? [r.error] : []),
  }));

  // Persist to disk so the API server can load it even when running separately
  try {
    const dataDir = join(dirname(fileURLToPath(import.meta.url)), "../../data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "last-scan.json"),
      JSON.stringify(lastScanSummary, null, 2),
      "utf8"
    );
  } catch (e) {
    console.warn(`[SCANNER] Could not persist last-scan.json: ${e.message}`);
  }

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
    console.log("Automated Scanner");
    console.log(`Interval : every ${SCAN_INTERVAL_MS / 1000}s / ${SCAN_INTERVAL_MS / 60000}min (skips if previous run active)`);
    console.log(`Mode     : ${config.paperTrade ? "PAPER TRADE" : "LIVE"}`);
    console.log(`Symbols  : ${STRATEGY.SYMBOLS.join(", ")}\n`);

    // Ping no Telegram que o scanner subiu (só se TELEGRAM_ENABLED=true).
    notify.startup(`Scanner (${config.paperTrade ? "PAPER" : "LIVE"})`).catch(() => {});

    // Run immediately, then on interval
    await runScanWithLock();
    setInterval(runScanWithLock, SCAN_INTERVAL_MS);

    console.log("\nScanner running. Press Ctrl+C to stop.");
  }
}

export { runScan, runScanWithLock };
