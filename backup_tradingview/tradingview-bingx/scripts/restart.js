// ─────────────────────────────────────────────────────────────────
//  restart.js  —  Stop + Start all tradingview-bingx services
//
//  Sequentially runs stop.js then start.js with a brief pause
//  between them so OS resources (ports, file handles) are released.
//
//  Usage: node scripts/restart.js
// ─────────────────────────────────────────────────────────────────

import { execFileSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const STOP_SCRIPT  = resolve(__dirname, "stop.js");
const START_SCRIPT = resolve(__dirname, "start.js");

console.log("╔══════════════════════════════════════════╗");
console.log("║     BTC/ETH Trader — Reiniciando         ║");
console.log("╚══════════════════════════════════════════╝\n");

// ── 1. Stop ────────────────────────────────────────────────────
try {
  execFileSync(process.execPath, [STOP_SCRIPT], { stdio: "inherit" });
} catch {
  // Services may not have been running — not an error
}

// ── 2. Brief pause — let the OS release ports and file handles ──
console.log("\n  Aguardando 2s...\n");
await new Promise((r) => setTimeout(r, 2000));

// ── 3. Start ───────────────────────────────────────────────────
execFileSync(process.execPath, [START_SCRIPT], { stdio: "inherit" });
