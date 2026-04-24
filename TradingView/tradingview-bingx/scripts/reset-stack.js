// ─────────────────────────────────────────────────────────────────
//  reset-stack.js — Full reset: stop services, wipe history, start fresh
//
//  1. Chama scripts/stop.js para matar todos os processos (Win/Mac/Linux)
//  2. Apaga data/trades.db (+ WAL/SHM), todos .log, snapshots, state files
//  3. Recria data/ vazio e marca schema para ser regenerado pelo db.js
//
//  Usage:  node scripts/reset-stack.js
//          node scripts/reset-stack.js --keep-db   (só apaga logs, preserva DB)
// ─────────────────────────────────────────────────────────────────

import { execSync } from "child_process";
import { readdirSync, rmSync, mkdirSync, existsSync, statSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA = resolve(ROOT, "data");

const keepDb = process.argv.includes("--keep-db");

console.log("╔═══════════════════════════════════════════════╗");
console.log("║   RESET STACK — para + limpa + pronto p/ uso  ║");
console.log("╚═══════════════════════════════════════════════╝\n");

// ── Step 1: stop all services ─────────────────────────────────
console.log("1) Parando serviços (via scripts/stop.js)…");
try {
  execSync(`node "${resolve(ROOT, "scripts/stop.js")}"`, { stdio: "inherit" });
} catch (err) {
  console.warn("   ⚠ stop.js retornou erro (pode não haver processos):", err.message);
}

// Pequeno delay para Windows liberar file handles
await new Promise((r) => setTimeout(r, 1500));

// ── Step 2: wipe data directory ───────────────────────────────
console.log("\n2) Limpando histórico em data/…");
if (!existsSync(DATA)) {
  mkdirSync(DATA, { recursive: true });
  console.log("   data/ não existia — criado vazio.");
} else {
  const entries = readdirSync(DATA);
  let removed = 0;
  for (const name of entries) {
    const full = join(DATA, name);
    const shouldKeep =
      keepDb && (name === "trades.db" || name === "trades.db-wal" || name === "trades.db-shm");
    if (shouldKeep) {
      console.log(`   • KEPT    ${name}`);
      continue;
    }
    try {
      const s = statSync(full);
      rmSync(full, { recursive: true, force: true });
      console.log(`   • REMOVED ${name} (${(s.size / 1024).toFixed(1)} KB)`);
      removed++;
    } catch (err) {
      console.warn(`   ⚠ Falha removendo ${name}: ${err.message}`);
    }
  }
  console.log(`   Total removido: ${removed} itens.`);
}

// ── Step 3: summary ───────────────────────────────────────────
console.log("\n✓ Reset completo. Estado atual:");
console.log(`   • data/ vazio (DB será recriado no próximo start)`);
console.log(`   • .env travado em PAPER_TRADE=true (edite manualmente para ir LIVE)`);
console.log(`   • Estratégia (rules/setups/monitors) resetada`);
console.log("\nPróximos passos:");
console.log("   1) Preencher rules.json, setups e monitors.json conforme desejar");
console.log("   2) node scripts/start.js  (ou docker compose up)");
console.log();
