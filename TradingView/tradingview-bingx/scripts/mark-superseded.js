// ─────────────────────────────────────────────────────────────────
//  mark-superseded.js — Marca um signal como SUPERSEDED manualmente
//
//  Usage:
//    node scripts/mark-superseded.js --signal=1 --by=2
//    node scripts/mark-superseded.js --signal=1 --by=2 --yes    (sem confirmação)
//
//  Quando usar:
//    • Cleanup retroativo de sinais órfãos (antes do dedup guard existir)
//    • Correção manual se um sinal ficou preso em APPROVED sem trade
//
//  Regras:
//    • --by deve ser um signal_id VÁLIDO que exista no DB
//    • --signal não pode já estar em CLOSED/REJECTED/EXPIRED (bloqueia transição inválida)
//    • Pede confirmação salvo se --yes
// ─────────────────────────────────────────────────────────────────

import readline from "readline";
import db from "../src/storage/db.js";

const args = process.argv.slice(2);
const getArg = (name) => {
  const m = args.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split("=").slice(1).join("=") : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const signalId = parseInt(getArg("signal"));
const byId     = parseInt(getArg("by"));
const skipConfirm = hasFlag("yes");

const C = {
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  grey:   (s) => `\x1b[90m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
};

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => { rl.close(); r(a.trim().toLowerCase()); }));
}

async function main() {
  if (!signalId || !byId) {
    console.log(C.red("Uso: node scripts/mark-superseded.js --signal=<id> --by=<id>"));
    process.exit(1);
  }

  const target = db.prepare("SELECT * FROM signals WHERE id = ?").get(signalId);
  const winner = db.prepare("SELECT * FROM signals WHERE id = ?").get(byId);

  if (!target) { console.log(C.red(`✗ Signal #${signalId} não existe.`)); process.exit(1); }
  if (!winner) { console.log(C.red(`✗ Signal #${byId} (--by) não existe.`)); process.exit(1); }

  if (["REJECTED", "EXPIRED", "SUPERSEDED"].includes(target.status)) {
    console.log(C.yellow(`⚠ Signal #${signalId} já está ${target.status}. Nada a fazer.`));
    process.exit(0);
  }

  console.log();
  console.log(C.bold(`Marking signal #${signalId} as SUPERSEDED:`));
  console.log(`  Target:  #${target.id}  ${target.symbol}  ${target.direction}  score=${target.score}  status=${target.status}  created=${target.created_at}`);
  console.log(`  Winner:  #${winner.id}  ${winner.symbol}  ${winner.direction}  score=${winner.score}  status=${winner.status}  created=${winner.created_at}`);

  if (target.symbol !== winner.symbol || target.direction !== winner.direction) {
    console.log(C.yellow(`⚠ Winner e target têm symbol/direction diferentes. Tem certeza?`));
  }

  if (!skipConfirm) {
    const a = await ask(C.yellow(`\nConfirma? (yes/no): `));
    if (a !== "yes" && a !== "y") { console.log(C.grey("Cancelado.")); return; }
  }

  const res = db
    .prepare(
      `UPDATE signals
          SET status = 'SUPERSEDED',
              superseded_by = ?,
              updated_at = datetime('now')
        WHERE id = ?`
    )
    .run(byId, signalId);

  if (res.changes === 1) {
    console.log(C.green(`✓ Signal #${signalId} marcado como SUPERSEDED by #${byId}`));
  } else {
    console.log(C.red(`✗ UPDATE falhou (changes=${res.changes})`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(C.red(`✗ Erro: ${err.message}`));
  process.exit(1);
});
