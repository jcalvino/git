// ─────────────────────────────────────────────────────────────────
//  debug-signal.js — Mostra o rationale completo de um ativo
//  Usage: node scripts/debug-signal.js NCCOGOLD2USD-USDT
//         node scripts/debug-signal.js NCSKTSLA2USD-USDT
//         node scripts/debug-signal.js BTCUSDT
// ─────────────────────────────────────────────────────────────────

import { analyzeTechnical, createBinanceAdapter } from "../src/analysis/technical.js";
import { evaluateSetups } from "../src/strategy/setups.js";

const symbol = process.argv[2] ?? "NCCOGOLD2USD-USDT";
console.log(`\n🔍 Debugging signal for: ${symbol}\n`);

const mcp = createBinanceAdapter();
mcp.setSymbol(symbol);

let tech;
try {
  tech = await analyzeTechnical(symbol, mcp);
} catch (err) {
  console.error(`❌ analyzeTechnical failed: ${err.message}`);
  process.exit(1);
}

// ── Print technical summary ───────────────────────────────────
console.log("═══ TECHNICAL DATA ═══");
console.log(`Price:       $${tech.price}`);
console.log(`Timeframes:  entry=${tech.timeframes?.entry} | trend=${tech.timeframes?.trend}`);
console.log(`\n15min (entry):`);
console.log(`  barCount:  ${tech.daily?.barCount}`);
console.log(`  EMA200:    ${tech.daily?.ema200?.toFixed(4) ?? "NULL"}`);
console.log(`  EMA9:      ${tech.entry?.ema9?.toFixed(4) ?? "NULL"}`);
console.log(`  EMA21:     ${tech.entry?.ema21?.toFixed(4) ?? "NULL"}`);
console.log(`  EMA50:     ${tech.entry?.ema50?.toFixed(4) ?? "NULL"}`);
console.log(`  RSI:       ${tech.entry?.rsi?.value?.toFixed(1) ?? "NULL"}`);
console.log(`\n1H (weekly/trend):`);
console.log(`  barCount:  ${tech.weekly?.barCount}`);
console.log(`  EMA9:      ${tech.weekly?.ema9?.toFixed(4) ?? "NULL"}`);
console.log(`  EMA21:     ${tech.weekly?.ema21?.toFixed(4) ?? "NULL"}`);
console.log(`  EMA50:     ${tech.weekly?.ema50?.toFixed(4) ?? "NULL"}`);
console.log(`  RSI:       ${tech.weekly?.rsi?.value?.toFixed(1) ?? "NULL"}`);
console.log(`\nWeekly (W):`);
console.log(`  RSI:       ${tech.weeklyFixed?.rsi?.value?.toFixed(1) ?? "NULL"}`);
console.log(`  MACD hist: ${tech.weeklyFixed?.macd?.histogram?.toFixed(4) ?? "NULL"}`);

// ── Run setups ────────────────────────────────────────────────
console.log("\n═══ SETUP EVALUATION ═══");
let setups;
try {
  setups = await evaluateSetups(symbol, tech, {});
} catch (err) {
  console.error(`❌ evaluateSetups failed: ${err.message}`);
  process.exit(1);
}

if (setups.length === 0) {
  console.log("No setups triggered.\n");
} else {
  for (const s of setups) {
    console.log(`\n✦ ${s.setup_name} — ${s.direction} — confidence: ${s.confidence}%`);
    for (const line of s.rationale) console.log(`  ${line}`);
  }
}

// ── Show NOT triggered setups with rationale ──────────────────
// Re-import to get all results including non-triggered
import { SETUPS } from "../src/config/strategy.js";
const { _evalEmaPullback, _evalSRBreakout } = await import("../src/strategy/setups.js").catch(() => ({}));

// Since internal functions aren't exported, use a workaround:
// Run generateSignal to get full rationale
import { generateSignal } from "../src/strategy/signals.js";
const signal = await generateSignal(symbol, tech, { fearGreed: { value: 50, label: "Neutral" }, hasHighRisk: false, riskWarnings: [], context: {} });

console.log("\n═══ SIGNAL RESULT ═══");
console.log(`Status:     ${signal.status}`);
console.log(`Direction:  ${signal.direction ?? "none"}`);
console.log(`Score:      ${signal.score}`);
console.log(`Setup:      ${signal.setup_name ?? "—"}`);
if (signal.rationale?.length) {
  console.log("\nRationale:");
  for (const line of signal.rationale) console.log(`  ${line}`);
}
