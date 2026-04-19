// ─────────────────────────────────────────────────────────────────
//  Scanner — Periodic BTC/ETH Analysis Bot
//  Runs every 4h (configurable), reads TradingView via MCP tools,
//  generates signals, saves to SQLite.
// ─────────────────────────────────────────────────────────────────

import cron from "node-cron";
import { fileURLToPath } from "url";
import { analyzeTechnical, createMcpAdapter } from "../analysis/technical.js";
import { analyzeMacro } from "../analysis/macro.js";
import { generateSignal } from "../strategy/signals.js";
import { saveSignal, upsertBingXPosition } from "../storage/trades.js";
import { saveSnapshot } from "../storage/trades.js";
import { getBalance, getPositions } from "../exchanges/bingx.js";
import config, { refreshCapital } from "../config/index.js";
import { STRATEGY } from "../config/strategy.js";

// ── Main Scan ──────────────────────────────────────────────────

// Shared last-scan summary (exposed via API for dashboard "no signal" panel)
export const lastScanSummary = {
  runAt: null,
  capital: null,
  symbols: [],
  results: [],   // [{ symbol, status, setup_name, score, rationale }]
  macroContext: null,
};

async function runScan() {
  const startTime = Date.now();
  console.log(`\n[${new Date().toISOString()}] Starting scan...`);
  console.log(`Mode: ${config.paperTrade ? "PAPER TRADE" : "LIVE"}`);
  console.log(`Symbols: ${STRATEGY.SYMBOLS.join(", ")}\n`);

  const results = [];

  // ── 1. Refresh live capital balance ────────────────────────────
  const liveCapital = await refreshCapital();
  try {
    const balance = await getBalance();
    console.log(
      `Capital: $${liveCapital.toFixed(2)} USDT | ` +
      `Disponível: $${balance.available?.toFixed(2)} | ` +
      `P&L aberto: $${balance.unrealizedPnl?.toFixed(2)}`
    );
  } catch {
    console.log(`Capital: $${liveCapital.toFixed(2)} USDT (paper mode ou sem API key)`);
  }
  console.log();

  // ── 2. Auto-sync posições abertas na BingX ──────────────────────
  try {
    const bingxPositions = await getPositions();
    if (bingxPositions.length > 0) {
      for (const pos of bingxPositions) {
        upsertBingXPosition(pos);
      }
      console.log(`Sincronizadas ${bingxPositions.length} posição(ões) da BingX\n`);
    }
  } catch {
    // Sem API key ou modo paper — continua sem sincronizar
  }

  try {
    // Connect to TradingView via MCP
    const mcp = await createMcpAdapter();
    console.log("Connected to TradingView Desktop\n");

    // Fetch macro analysis once (shared across symbols)
    const macro = await analyzeMacro();
    console.log(
      `Macro: Fear/Greed ${macro.fearGreed.value} (${macro.fearGreed.label})`
    );
    console.log(`Bias: ${macro.context?.overallBias ?? "unknown"}`);
    if (macro.hasHighRisk) {
      console.log(
        `HIGH RISK: ${macro.riskWarnings
          .filter((w) => w.severity === "high")
          .map((w) => w.type)
          .join(", ")}`
      );
    }
    lastScanSummary.macroContext = {
      fearGreed: macro.fearGreed,
      bias: macro.context?.overallBias,
      hasHighRisk: macro.hasHighRisk,
      warnings: macro.riskWarnings?.filter((w) => w.severity === "high").map((w) => w.type) ?? [],
    };
    console.log();

    // Analyze each symbol
    for (const symbol of STRATEGY.SYMBOLS) {
      // Skip symbols pending confirmation (e.g. Oil until BingX symbol verified)
      const symCfg = STRATEGY.SYMBOL_CONFIG?.[symbol];
      if (symCfg && !symCfg.enabled) {
        console.log(`Skipping ${symbol}: ${symCfg.pendingReason ?? "disabled"}\n`);
        results.push({ symbol, signal: { status: "DISABLED", direction: null, score: 0, rationale: [symCfg.pendingReason ?? "disabled"] } });
        continue;
      }

      // TradingView may use a different symbol identifier than BingX
      // (e.g. XAUUSDT on BingX → XAUUSD on TradingView)
      const tvSymbol = STRATEGY.SYMBOL_TV_MAP?.[symbol] ?? symbol;
      console.log(`Analyzing ${symbol}${tvSymbol !== symbol ? ` (TV: ${tvSymbol})` : ""}...`);

      try {
        // 1. Technical analysis via TradingView MCP (uses TV symbol for chart)
        const technical = await analyzeTechnical(tvSymbol, mcp);
        // Restore internal BingX symbol so downstream modules use correct API calls
        technical.symbol = symbol;

        console.log(
          `  Price: $${technical.price.toLocaleString()} | ` +
            `EMA200/D: ${technical.daily.ema200 ? "$" + technical.daily.ema200.toLocaleString() : "N/A"} | ` +
            `EMA21/W: ${technical.weekly.ema21 ? "$" + technical.weekly.ema21.toLocaleString() : "N/A"}`
        );
        console.log(
          `  RSI/W: ${technical.weekly.rsi?.toFixed(1) ?? "N/A"} | ` +
            `MACD hist: ${technical.weekly.macd?.histogram?.toFixed(0) ?? "N/A"}`
        );

        // 2. Generate signal (evaluates all 5 setups)
        const signal = await generateSignal(symbol, technical, macro);

        const statusLine =
          `  Signal: ${signal.direction ?? "none"} | ` +
          `Score: ${signal.score}% | ` +
          `Status: ${signal.status}`;
        console.log(statusLine);

        if (signal.setup_name) {
          console.log(`  Setup : ${signal.setup_name} (${signal.leverage}x leverage)`);
        }

        // Only save and alert on actionable signals (direction must be set)
        if (!signal.direction || signal.status === "BELOW_THRESHOLD") {
          console.log(`  → Nenhum setup ativado: ${signal.rationale?.[0] ?? "abaixo do threshold"}\n`);
          results.push({ symbol, signal });
          continue;
        }

        console.log(
          `  ✦ ALERTA: Entry $${signal.entry?.toLocaleString()} | ` +
          `SL $${signal.sl?.toLocaleString()} | TP1 $${signal.tp1?.toLocaleString()}`
        );
        if (signal.rationale?.length) {
          console.log(`  Razão : ${signal.rationale[0]}`);
        }

        // 3. Save to database only when a valid setup fired
        const signalId = saveSignal(signal);
        console.log(`  Salvo → sinal #${signalId}\n`);

        results.push({ symbol, signalId, signal });
      } catch (symbolErr) {
        console.error(`  ERROR scanning ${symbol}: ${symbolErr.message}\n`);
        results.push({ symbol, error: symbolErr.message });
      }
    }

    // Save daily equity snapshot
    try {
      const balance = await getBalance();
      saveSnapshot(balance.total || config.capitalUsdt);
    } catch {
      saveSnapshot(config.capitalUsdt); // fallback in paper mode
    }
  } catch (err) {
    console.error(`Scan failed: ${err.message}`);
    if (err.message.includes("TradingView")) {
      console.error(
        "\nMake sure TradingView Desktop is running with CDP enabled.\n" +
          "Run: ..\\tradingview-mcp-jackson\\scripts\\launch_tv_debug.vbs"
      );
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Scan complete in ${elapsed}s`);

  // ── Atualiza resumo do último scan (consumido pelo dashboard) ──
  lastScanSummary.runAt      = new Date().toISOString();
  lastScanSummary.capital    = config.capitalUsdt;
  lastScanSummary.symbols    = STRATEGY.SYMBOLS;
  lastScanSummary.results    = results.map((r) => ({
    symbol:     r.symbol,
    status:     r.signal?.status ?? (r.error ? "ERROR" : "BELOW_THRESHOLD"),
    setup_name: r.signal?.setup_name ?? null,
    score:      r.signal?.score ?? 0,
    direction:  r.signal?.direction ?? null,
    rationale:  r.signal?.rationale ?? (r.error ? [r.error] : []),
  }));
  lastScanSummary.macroContext = null; // populated below if macro ran

  // Summary table
  if (results.length > 0) {
    console.log("\n┌─────────────┬────────┬───────┬──────────────────────┐");
    console.log("│ Symbol      │ Dir    │ Score │ Status               │");
    console.log("├─────────────┼────────┼───────┼──────────────────────┤");
    for (const r of results) {
      if (r.error) {
        console.log(
          `│ ${r.symbol.padEnd(11)} │ ERROR  │   -   │ ${r.error.slice(0, 20).padEnd(20)} │`
        );
      } else {
        const s = r.signal;
        const dir = s.direction ?? "none";
        const status = s.status ?? "";
        console.log(
          `│ ${r.symbol.padEnd(11)} │ ${dir.padEnd(6)} │ ${String(s.score ?? 0).padStart(5)} │ ${status.slice(0, 20).padEnd(20)} │`
        );
      }
    }
    console.log("└─────────────┴────────┴───────┴──────────────────────┘");
  }

  return results;
}

// ── Entry Point ────────────────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const runOnce = process.argv.includes("--once");

  if (runOnce) {
    // Single run mode
    await runScan();
    process.exit(0);
  } else {
    // Cron mode
    console.log(`BTC/ETH Trader Scanner starting...`);
    console.log(`Schedule: ${config.scanCron}`);
    console.log(`Mode: ${config.paperTrade ? "PAPER TRADE" : "LIVE"}\n`);

    // Run immediately on start
    await runScan();

    // Then on schedule
    cron.schedule(config.scanCron, runScan, {
      timezone: "America/New_York",
    });

    console.log(`\nScanner running. Press Ctrl+C to stop.`);
  }
}

export { runScan };
