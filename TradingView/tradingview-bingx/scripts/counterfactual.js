// ─────────────────────────────────────────────────────────────────
//  counterfactual.js — Replay histórico dos sinais pra calibrar MIN_SCORE
//
//  Usage:
//    node scripts/counterfactual.js                      (exclui SUPERSEDED)
//    node scripts/counterfactual.js --include-superseded (inclui tudo)
//    node scripts/counterfactual.js --status=BELOW_THRESHOLD
//    node scripts/counterfactual.js --symbol=BTCUSDC
//    node scripts/counterfactual.js --signal=42          (só 1 sinal)
//    node scripts/counterfactual.js --csv                (exporta CSV)
//
//  Pra cada sinal no DB:
//    1. Busca OHLCV (H1) desde created_at até now (ou SL/TP hit, ou 7 dias)
//    2. Simula: entrada imediata @ signal.price, checa SL/TP1 tick-by-tick
//    3. Reporta outcome: WIN (TP1 hit) | LOSS (SL hit) | OPEN | EXPIRED
//    4. Calcula P&L hipotético em USD (usando risk_dollars do signal)
//
//  Agrega por bucket de score pra decidir MIN_SCORE:
//    <60 | 60-65 | 65-70 | 70-75 | 75-80 | 80+
//    cada bucket: count, win_rate, avg_pnl, total_pnl, expectancy
//
//  IMPORTANTE: assume entrada imediata ao signal.price. Na real o executor
//  pode entrar em pullback (signal.entry pode ser diferente de signal.price).
//  Isso simplifica a simulação mas gera leve viés otimista nos WIN rates.
// ─────────────────────────────────────────────────────────────────

import db from "../src/storage/db.js";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── CLI args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => {
  const m = args.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split("=").slice(1).join("=") : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const statusFilter = getArg("status");
const symbolFilter = getArg("symbol");
const signalId     = getArg("signal");
const exportCsv    = hasFlag("csv");

// ── Constants ──────────────────────────────────────────────────
const INTERVAL = "1h";          // H1 granularity
const MAX_DAYS = 7;             // janela máxima de observação
const MS_PER_HOUR = 3600 * 1000;

// ── Colors ──────────────────────────────────────────────────────
const C = {
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  grey:   (s) => `\x1b[90m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
};

// ── Fetch Binance klines with startTime/endTime ─────────────────
async function fetchKlinesRange(symbol, interval, startMs, endMs) {
  const url =
    `https://api.binance.com/api/v3/klines?symbol=${symbol}` +
    `&interval=${interval}&startTime=${startMs}&endTime=${endMs}&limit=1000`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance klines error for ${symbol}: HTTP ${res.status} ${body}`);
  }
  const raw = await res.json();
  return raw.map(([time, open, high, low, close]) => ({
    time:  Math.floor(time / 1000),
    open:  parseFloat(open),
    high:  parseFloat(high),
    low:   parseFloat(low),
    close: parseFloat(close),
  }));
}

// ── Simulate one signal ─────────────────────────────────────────
function simulate(signal, bars) {
  const { direction, entry, sl, tp1, risk_dollars } = signal;
  // R multiple (distance to tp1 / distance to sl)
  const slDist  = Math.abs(entry - sl);
  const tp1Dist = Math.abs(tp1 - entry);
  const rMultiple = slDist > 0 ? tp1Dist / slDist : 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    let hitSl  = false;
    let hitTp1 = false;

    if (direction === "LONG") {
      if (bar.low  <= sl)  hitSl  = true;
      if (bar.high >= tp1) hitTp1 = true;
    } else {
      if (bar.high >= sl)  hitSl  = true;
      if (bar.low  <= tp1) hitTp1 = true;
    }

    // Ambos na mesma barra: assume pior (SL) — conservador
    if (hitSl) {
      return {
        outcome: "LOSS",
        barsToOutcome: i + 1,
        hoursToOutcome: i + 1,
        hypoPnl: -risk_dollars,
        rMultiple,
      };
    }
    if (hitTp1) {
      return {
        outcome: "WIN",
        barsToOutcome: i + 1,
        hoursToOutcome: i + 1,
        hypoPnl: risk_dollars * rMultiple,
        rMultiple,
      };
    }
  }

  // Não bateu em nenhuma barra da janela observada
  return {
    outcome: bars.length === 0 ? "NO_DATA" : "OPEN",
    barsToOutcome: bars.length,
    hoursToOutcome: bars.length,
    hypoPnl: 0,
    rMultiple,
  };
}

// ── Query signals ───────────────────────────────────────────────
// Por padrão exclui SUPERSEDED (sinais órfãos que nunca virariam trade) pra
// não inflar estatísticas. Use --include-superseded pra ver todos.
function loadSignals() {
  const includeSuperseded = hasFlag("include-superseded");
  let sql = "SELECT * FROM signals WHERE 1=1";
  const params = [];
  if (signalId)     { sql += " AND id = ?";     params.push(parseInt(signalId)); }
  if (statusFilter) { sql += " AND status = ?"; params.push(statusFilter); }
  if (symbolFilter) { sql += " AND symbol = ?"; params.push(symbolFilter); }
  if (!includeSuperseded && !statusFilter) {
    sql += " AND status != 'SUPERSEDED'";
  }
  sql += " ORDER BY created_at DESC";
  return db.prepare(sql).all(...params);
}

// ── Aggregation ─────────────────────────────────────────────────
function bucketOf(score) {
  if (score < 60) return "<60";
  if (score < 65) return "60-65";
  if (score < 70) return "65-70";
  if (score < 75) return "70-75";
  if (score < 80) return "75-80";
  return "80+";
}

function aggregate(results) {
  const buckets = {};
  for (const r of results) {
    const b = bucketOf(r.signal.score);
    if (!buckets[b]) buckets[b] = { count: 0, wins: 0, losses: 0, open: 0, noData: 0, totalPnl: 0 };
    buckets[b].count++;
    if (r.sim.outcome === "WIN")     { buckets[b].wins++;   buckets[b].totalPnl += r.sim.hypoPnl; }
    if (r.sim.outcome === "LOSS")    { buckets[b].losses++; buckets[b].totalPnl += r.sim.hypoPnl; }
    if (r.sim.outcome === "OPEN")      buckets[b].open++;
    if (r.sim.outcome === "NO_DATA")   buckets[b].noData++;
  }
  return buckets;
}

// ── Rendering ───────────────────────────────────────────────────
function renderOutcome(outcome) {
  switch (outcome) {
    case "WIN":     return C.green("WIN    ");
    case "LOSS":    return C.red("LOSS   ");
    case "OPEN":    return C.grey("OPEN   ");
    case "NO_DATA": return C.yellow("NO_DATA");
    default:        return outcome;
  }
}

function printResults(results) {
  console.log();
  console.log(C.bold("═══ Counterfactual por sinal ═══"));
  console.log();
  console.log(
    C.bold(
      [
        "ID".padStart(4),
        "Data".padEnd(12),
        "Sym".padEnd(9),
        "Dir".padEnd(5),
        "Score".padStart(6),
        "Status".padEnd(17),
        "Outcome".padEnd(8),
        "Hours".padStart(6),
        "Hypo P&L".padStart(10),
        "R".padStart(5),
      ].join(" | ")
    )
  );
  console.log(C.grey("─".repeat(110)));

  for (const r of results) {
    const s = r.signal;
    const date = s.created_at.slice(0, 10);
    const pnl  = r.sim.hypoPnl;
    const pnlStr =
      pnl > 0  ? C.green(`+$${pnl.toFixed(2)}`.padStart(10))
      : pnl < 0 ? C.red(`-$${Math.abs(pnl).toFixed(2)}`.padStart(10))
      :           C.grey("—".padStart(10));

    console.log(
      [
        String(s.id).padStart(4),
        date.padEnd(12),
        s.symbol.padEnd(9),
        s.direction.padEnd(5),
        String(s.score.toFixed(0)).padStart(6),
        (s.status ?? "").padEnd(17),
        renderOutcome(r.sim.outcome),
        String(r.sim.hoursToOutcome).padStart(6),
        pnlStr,
        r.sim.rMultiple.toFixed(2).padStart(5),
      ].join(" | ")
    );
  }
}

function printAggregation(buckets) {
  console.log();
  console.log(C.bold("═══ Agregação por bucket de score ═══"));
  console.log();
  console.log(
    C.bold(
      [
        "Bucket".padEnd(8),
        "Count".padStart(6),
        "Wins".padStart(5),
        "Losses".padStart(7),
        "Open".padStart(5),
        "Win%".padStart(7),
        "Total P&L".padStart(11),
        "Expectancy".padStart(12),
      ].join(" | ")
    )
  );
  console.log(C.grey("─".repeat(80)));

  const order = ["<60", "60-65", "65-70", "70-75", "75-80", "80+"];
  for (const k of order) {
    const b = buckets[k];
    if (!b) continue;
    const resolved = b.wins + b.losses;
    const winRate  = resolved > 0 ? (b.wins / resolved) * 100 : 0;
    const expectancy = resolved > 0 ? b.totalPnl / resolved : 0;
    const wrColor = winRate >= 50 ? C.green : winRate >= 40 ? C.yellow : C.red;
    const pnlColor = b.totalPnl > 0 ? C.green : b.totalPnl < 0 ? C.red : C.grey;
    console.log(
      [
        k.padEnd(8),
        String(b.count).padStart(6),
        String(b.wins).padStart(5),
        String(b.losses).padStart(7),
        String(b.open + b.noData).padStart(5),
        wrColor(`${winRate.toFixed(1)}%`.padStart(7)),
        pnlColor(`$${b.totalPnl.toFixed(2)}`.padStart(11)),
        pnlColor(`$${expectancy.toFixed(2)}`.padStart(12)),
      ].join(" | ")
    );
  }
  console.log();
  console.log(C.cyan("  Dica: bucket com win rate >= 50% e expectancy > $0 = seguro para incluir no MIN_SCORE"));
}

// ── CSV export ──────────────────────────────────────────────────
function writeCsv(results) {
  mkdirSync(resolve(ROOT, "data/reports"), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const path  = resolve(ROOT, `data/reports/counterfactual-${stamp}.csv`);
  const header = "id,created_at,symbol,direction,score,status,entry,sl,tp1,risk_dollars,outcome,hours_to_outcome,hypo_pnl,r_multiple";
  const lines = results.map((r) => {
    const s = r.signal;
    return [
      s.id, s.created_at, s.symbol, s.direction, s.score, s.status,
      s.entry, s.sl, s.tp1, s.risk_dollars,
      r.sim.outcome, r.sim.hoursToOutcome, r.sim.hypoPnl.toFixed(4), r.sim.rMultiple.toFixed(4),
    ].join(",");
  });
  writeFileSync(path, [header, ...lines].join("\n") + "\n");
  console.log(C.grey(`\n  CSV salvo em ${path}`));
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  const signals = loadSignals();
  if (signals.length === 0) {
    console.log(C.grey("Nenhum sinal encontrado pros filtros dados."));
    return;
  }
  console.log(C.bold(`\nProcessando ${signals.length} sinal(is)...`));

  const results = [];
  for (const s of signals) {
    const startMs = new Date(s.created_at).getTime();
    const endMs   = Math.min(Date.now(), startMs + MAX_DAYS * 24 * MS_PER_HOUR);
    let bars = [];
    try {
      bars = await fetchKlinesRange(s.symbol, INTERVAL, startMs, endMs);
    } catch (err) {
      console.warn(C.yellow(`  ⚠ signal #${s.id} — fetch falhou: ${err.message}`));
    }
    const sim = simulate(s, bars);
    results.push({ signal: s, sim });
    // Rate limit respect: pause 100ms
    await new Promise((r) => setTimeout(r, 100));
  }

  printResults(results);

  const buckets = aggregate(results);
  printAggregation(buckets);

  if (exportCsv) writeCsv(results);
}

main().catch((err) => {
  console.error(C.red(`\n✗ Erro: ${err.message}`));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
