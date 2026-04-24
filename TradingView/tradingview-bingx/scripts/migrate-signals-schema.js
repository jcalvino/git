// ─────────────────────────────────────────────────────────────────
//  migrate-signals-schema.js — Migra signals table (idempotente)
//
//  Adiciona:
//    1. 'SUPERSEDED' ao CHECK constraint de status
//    2. Coluna superseded_by INTEGER REFERENCES signals(id)
//
//  Usage:
//    node scripts/migrate-signals-schema.js           (dry-run, mostra plano)
//    node scripts/migrate-signals-schema.js --apply   (executa migração)
//
//  Seguro:
//    - Detecta se migração já foi aplicada e encerra cedo
//    - Dump completo da tabela ANTES de alterar (data/backups/signals-YYYYMMDD-HHMMSS.json)
//    - Transação: rollback automático se algo falhar
// ─────────────────────────────────────────────────────────────────

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import config from "../src/config/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");

const C = {
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  grey:   (s) => `\x1b[90m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
};

const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA foreign_keys = OFF"); // durante migração

// ── Inspect current schema ──────────────────────────────────────
function currentSchema() {
  const row = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='signals'`
  ).get();
  return row?.sql ?? "";
}

function currentColumns() {
  return db.prepare(`PRAGMA table_info(signals)`).all();
}

// ── Check if migration needed ───────────────────────────────────
function needsMigration() {
  const schema = currentSchema();
  const cols   = currentColumns();
  const hasSuperseded    = schema.includes("SUPERSEDED");
  const hasSupersededCol = cols.some((c) => c.name === "superseded_by");
  return !hasSuperseded || !hasSupersededCol;
}

// ── Backup to JSON ──────────────────────────────────────────────
function backupSignals() {
  const rows = db.prepare(`SELECT * FROM signals`).all();
  mkdirSync(resolve(ROOT, "data/backups"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = resolve(ROOT, `data/backups/signals-${stamp}.json`);
  writeFileSync(path, JSON.stringify(rows, null, 2));
  return { path, count: rows.length };
}

// ── Do migration ────────────────────────────────────────────────
function migrate() {
  db.exec("BEGIN TRANSACTION");
  try {
    // 1. Rename old table
    db.exec("ALTER TABLE signals RENAME TO signals_old");

    // 2. Create new table with updated schema
    db.exec(`
      CREATE TABLE signals (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol      TEXT NOT NULL,
        direction   TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
        score       REAL NOT NULL,
        trade_type  TEXT NOT NULL DEFAULT 'SWING',
        price       REAL NOT NULL,
        entry       REAL NOT NULL,
        sl          REAL NOT NULL,
        tp1         REAL NOT NULL,
        tp2         REAL NOT NULL,
        tp3         REAL NOT NULL,
        position_size REAL NOT NULL DEFAULT 0,
        position_value REAL NOT NULL DEFAULT 0,
        risk_dollars  REAL NOT NULL DEFAULT 0,
        breakdown   TEXT,
        inputs      TEXT,
        status      TEXT NOT NULL DEFAULT 'PENDING_APPROVAL'
                      CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'BELOW_THRESHOLD', 'SUPERSEDED')),
        superseded_by INTEGER REFERENCES signals(id),
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // 3. Copy data (superseded_by = NULL for all existing rows)
    db.exec(`
      INSERT INTO signals (
        id, symbol, direction, score, trade_type, price, entry, sl, tp1, tp2, tp3,
        position_size, position_value, risk_dollars, breakdown, inputs, status,
        superseded_by, created_at, updated_at
      )
      SELECT
        id, symbol, direction, score, trade_type, price, entry, sl, tp1, tp2, tp3,
        position_size, position_value, risk_dollars, breakdown, inputs, status,
        NULL as superseded_by, created_at, updated_at
      FROM signals_old
    `);

    // 4. Drop old
    db.exec("DROP TABLE signals_old");

    db.exec("COMMIT");
    return { ok: true };
  } catch (err) {
    db.exec("ROLLBACK");
    return { ok: false, error: err.message };
  }
}

// ── Main ────────────────────────────────────────────────────────
console.log(C.bold("\n═══ Signals schema migration ═══\n"));
console.log(C.grey(`  DB: ${config.dbPath}`));
console.log(C.grey(`  Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`));
console.log();

if (!needsMigration()) {
  console.log(C.green("✓ Migração já aplicada. Nada a fazer."));
  const cols = currentColumns();
  const supersededCol = cols.find((c) => c.name === "superseded_by");
  console.log(C.grey(`  Coluna superseded_by: ${supersededCol ? "existe" : "FALTA"}`));
  console.log(C.grey(`  CHECK inclui SUPERSEDED: ${currentSchema().includes("SUPERSEDED") ? "sim" : "não"}`));
  process.exit(0);
}

console.log(C.yellow("⚠ Migração necessária:"));
const schema = currentSchema();
const cols   = currentColumns();
if (!schema.includes("SUPERSEDED")) console.log(C.yellow("  • Adicionar 'SUPERSEDED' ao CHECK constraint"));
if (!cols.some((c) => c.name === "superseded_by")) console.log(C.yellow("  • Adicionar coluna superseded_by"));

const signalCount = db.prepare("SELECT COUNT(*) as n FROM signals").get().n;
console.log(C.grey(`  Sinais existentes no DB: ${signalCount}`));

if (!APPLY) {
  console.log();
  console.log(C.cyan("Dry-run. Pra aplicar de verdade:"));
  console.log(C.cyan("  node scripts/migrate-signals-schema.js --apply"));
  process.exit(0);
}

// Backup
console.log();
console.log(C.cyan("1/2  Backup..."));
const backup = backupSignals();
console.log(C.green(`     ✓ ${backup.count} sinais → ${backup.path}`));

// Migrate
console.log(C.cyan("2/2  Migrando schema..."));
const result = migrate();
if (!result.ok) {
  console.log(C.red(`     ✗ FALHOU: ${result.error}`));
  console.log(C.red("     ROLLBACK aplicado. Nenhuma mudança persistiu."));
  console.log(C.grey(`     Backup preservado em ${backup.path}`));
  process.exit(1);
}

// Verify
const verifySchema = currentSchema();
const verifyCols   = currentColumns();
const verifyCount  = db.prepare("SELECT COUNT(*) as n FROM signals").get().n;

console.log(C.green(`     ✓ Schema atualizado`));
console.log(C.grey(`       • SUPERSEDED no CHECK: ${verifySchema.includes("SUPERSEDED") ? "sim" : "NÃO"}`));
console.log(C.grey(`       • Coluna superseded_by: ${verifyCols.some((c) => c.name === "superseded_by") ? "sim" : "NÃO"}`));
console.log(C.grey(`       • Sinais preservados: ${verifyCount}/${signalCount}`));

if (verifyCount !== signalCount) {
  console.log(C.red(`     ✗ CONTAGEM DIVERGENTE — restaure do backup: ${backup.path}`));
  process.exit(1);
}

console.log();
console.log(C.green(C.bold("✓ Migração concluída.")));
console.log(C.cyan("\n  Próximo passo (marcar Signal #1 como SUPERSEDED):"));
console.log(C.cyan("  sqlite3 data/trades.db \"UPDATE signals SET status='SUPERSEDED', superseded_by=2 WHERE id=1\""));
console.log(C.cyan("  (ou rode o script dedicado: node scripts/mark-superseded.js --signal=1 --by=2)"));
