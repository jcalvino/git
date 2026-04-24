// ─────────────────────────────────────────────────────────────────
//  counterfactual-by-setup.js — Replay agrupado por setup_id
//
//  Mesma lógica do counterfactual.js mas, em vez de bucketizar por score,
//  agrupa por (setup_id, direction). Permite identificar qual setup tá
//  carregando a estratégia e qual tá puxando pra baixo.
//
//  Usage:
//    node scripts/counterfactual-by-setup.js                      (últimos 30d)
//    node scripts/counterfactual-by-setup.js --days=7
//    node scripts/counterfactual-by-setup.js --symbol=BTCUSDC
//    node scripts/counterfactual-by-setup.js --include-superseded
//    node scripts/counterfactual-by-setup.js --csv
//
//  IMPORTANTE: não altera setups.js/signals.js — só LÊ do DB e do
//  histórico de klines. Output é diagnóstico puro; mudança de
//  config exige aprovação explícita (governança).
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

const daysBack     = parseInt(getArg("days") || "30");
const symbolFilter = getArg("symbol");
const exportCsv    = hasFlag("csv");
const includeSup   = hasFlag("include-superseded");

// ── Constants ───────────────────────────────────────────────────
const INTERVAL = "1h";
const MAX_DAYS = 7;
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

// ── Fetch Binance klines (reusa lógica do counterfactual) ───────
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

function simulate(signal, bars) {
  const { direction, entry, sl, tp1, risk_dollars } = signal;
  const slDist  = Math.abs(entry - sl);
  const tp1Dist = Math.abs(tp1 - entry);
  const rMultiple = slDist > 0 ? tp1Dist / slDist : 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    let hitSl = false, hitTp1 = false;
    if (direction === "LONG") {
      if (bar.low  <= sl)  hitSl  = true;
      if (bar.high >= tp1) hitTp1 = true;
    } else {
      if (bar.high >= sl)  hitSl  = true;
      if (bar.low  <= tp1) hitTp1 = true;
    }
    if (hitSl)  return { outcome: "LOSS", hoursToOutcome: i + 1, hypoPnl: -risk_dollars, rMultiple };
    if (hitTp1) return { outcome: "WIN",  hoursToOutcome: i + 1, hypoPnl: risk_dollars * rMultiple, rMultiple };
  }
  return {
    outcome: bars.length === 0 ? "NO_DATA" : "OPEN",
    hoursToOutcome: bars.length,
    hypoPnl: 0,
    rMultiple,
  };
}

// ── Load signals ────────────────────────────────────────────────
function loadSignals() {
  let sql = `SELECT * FROM signals
             WHERE datetime(created_at) >= datetime('now', ?)`;
  const params = [`-${daysBack} days`];
  if (symbolFilter) { sql += " AND symbol = ?"; params.push(symbolFilter); }
  if (!includeSup)  { sql += " AND status != 'SUPERSEDED'"; }
  sql += " ORDER BY created_at DESC";
  return db.prepare(sql).all(...params);
}

// ── Aggregate por (setup_id, direction) ─────────────────────────
function aggregate(results) {
  const groups = {};
  for (const r of results) {
    const sid = r.signal.setup_id ?? "UNKNOWN";
    const dir = r.signal.direction;
    const key = `${sid} · ${dir}`;
    if (!groups[key]) {
      groups[key] = {
        setup_id: sid,
        setup_name: r.signal.setup_name ?? sid,
        direction: dir,
        count: 0, wins: 0, losses: 0, open: 0, noData: 0, totalPnl: 0,
        scores: [],
      };
    }
    const g = groups[key];
    g.count++;
    g.scores.push(r.signal.score);
    if (r.sim.outcome === "WIN")     { g.wins++;   g.totalPnl += r.sim.hypoPnl; }
    if (r.sim.outcome === "LOSS")    { g.losses++; g.totalPnl += r.sim.hypoPnl; }
    if (r.sim.outcome === "OPEN")      g.open++;
    if (r.sim.outcome === "NO_DATA")   g.noData++;
  }
  return groups;
}

function avg(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

function printAggregation(groups) {
  console.log();
  console.log(C.bold("═══ Agregação por setup × direction ═══"));
  console.log();
  console.log(
    C.bold(
      [
        "Setup".padEnd(28),
        "Dir".padEnd(6),
        "N".padStart(4),
        "W".padStart(4),
        "L".padStart(4),
        "Open".padStart(5),
        "Win%".padStart(7),
        "Total P&L".padStart(11),
        "Expectancy".padStart(12),
        "AvgScore".padStart(9),
      ].join(" | ")
    )
  );
  console.log(C.grey("─".repeat(105)));

  const keys = Object.keys(groups).sort((a, b) => {
    // ordena por expectancy desc
    const ra = (groups[a].wins + groups[a].losses) > 0 ? groups[a].totalPnl / (groups[a].wins + groups[a].losses) : -Infinity;
    const rb = (groups[b].wins + groups[b].losses) > 0 ? groups[b].totalPnl / (groups[b].wins + groups[b].losses) : -Infinity;
    return rb - ra;
  });

  for (const k of keys) {
    const g = groups[k];
    const resolved = g.wins + g.losses;
    const wr = resolved > 0 ? (g.wins / resolved) * 100 : 0;
    const exp = resolved > 0 ? g.totalPnl / resolved : 0;
    const wrColor  = wr >= 50 ? C.green : wr >= 40 ? C.yellow : C.red;
    const pnlColor = g.totalPnl > 0 ? C.green : g.totalPnl < 0 ? C.red : C.grey;
    console.log(
      [
        g.setup_id.padEnd(28),
        g.direction.padEnd(6),
        String(g.count).padStart(4),
        String(g.wins).padStart(4),
        String(g.losses).padStart(4),
        String(g.open + g.noData).padStart(5),
        wrColor(`${wr.toFixed(1)}%`.padStart(7)),
        pnlColor(`$${g.totalPnl.toFixed(2)}`.padStart(11)),
        pnlColor(`$${exp.toFixed(2)}`.padStart(12)),
        avg(g.scores).toFixed(1).padStart(9),
      ].join(" | ")
    );
  }
  console.log();
  console.log(C.cyan("  Grupo com N >= 5, WR >= 50% e expectancy > 0 = candidato sólido."));
  console.log(C.cyan("  Grupo com N >= 5, WR < 40% e expectancy < 0 = candidato a depreciar (propor mudança)."));
}

// ── CSV export ──────────────────────────────────────────────────
function writeCsv(groups) {
  mkdirSync(resolve(ROOT, "data/reports"), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const path  = resolve(ROOT, `data/reports/counterfactual-by-setup-${stamp}.csv`);
  const header = "setup_id,setup_name,direction,count,wins,losses,open,win_rate_pct,total_pnl,expectancy,avg_score";
  const lines = Object.values(groups).map((g) => {
    const resolved = g.wins + g.losses;
    const wr = resolved > 0 ? (g.wins / resolved) * 100 : 0;
    const exp = resolved > 0 ? g.totalPnl / resolved : 0;
    return [
      g.setup_id, `"${(g.setup_name || "").replace(/"/g, '""')}"`, g.direction,
      g.count, g.wins, g.losses, g.open + g.noData,
      wr.toFixed(2), g.totalPnl.toFixed(4), exp.toFixed(4), avg(g.scores).toFixed(2),
    ].join(",");
  });
  writeFileSync(path, [header, ...lines].join("\n") + "\n");
  console.log(C.grey(`\n  CSV salvo em ${path}`));
}

// ── Exports pro weekly-report ───────────────────────────────────
export { fetchKlinesRange, simulate, aggregate };

// ── Main ────────────────────────────────────────────────────────
async function main() {
  const signals = loadSignals();
  if (signals.length === 0) {
    console.log(C.grey(`Nenhum sinal encontrado nos últimos ${daysBack} dias (symbol=${symbolFilter ?? "*"}).`));
    return;
  }
  console.log(C.bold(`\nProcessando ${signals.length} sinal(is) dos últimos ${daysBack} dias...`));

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
    await new Promise((r) => setTimeout(r, 100));
  }

  const groups = aggregate(results);
  printAggregation(groups);

  // Resumo geral
  const allResolved = Object.values(groups).reduce((a, g) => a + g.wins + g.losses, 0);
  const allPnl      = Object.values(groups).reduce((a, g) => a + g.totalPnl, 0);
  const allWins     = Object.values(groups).reduce((a, g) => a + g.wins, 0);
  console.log();
  console.log(C.bold("Resumo geral:"));
  console.log(`  Sinais processados: ${results.length}`);
  console.log(`  Resolvidos (WIN+LOSS): ${allResolved}`);
  console.log(`  Win rate geral: ${allResolved > 0 ? ((allWins / allResolved) * 100).toFixed(1) : 0}%`);
  console.log(`  Total P&L hipotético: $${allPnl.toFixed(2)}`);

  if (exportCsv) writeCsv(groups);
}

// Só roda se chamado direto — import por outros scripts não dispara
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(C.red(`\n✗ Erro: ${err.message}`));
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  });
}
