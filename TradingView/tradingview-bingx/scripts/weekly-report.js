// ─────────────────────────────────────────────────────────────────
//  weekly-report.js — Relatório semanal de performance + counterfactual
//
//  Usage:
//    node scripts/weekly-report.js                    (semana corrente)
//    node scripts/weekly-report.js --weeks=2          (últimas N semanas)
//    node scripts/weekly-report.js --since=2026-04-01 (a partir de data custom)
//    node scripts/weekly-report.js --quiet            (só grava arquivo)
//
//  O relatório inclui:
//    1. Header com janela + capital atual
//    2. Trades executados (abertos + fechados) + P&L
//    3. Evolução de capital (snapshots)
//    4. Signals por status (APPROVED / BELOW_THRESHOLD / SUPERSEDED / REJECTED)
//    5. Counterfactual agregado por bucket de score (H1 replay, 7d window)
//    6. Recomendação MIN_SCORE baseada no que foi observado
//
//  Output:
//    data/reports/weekly-YYYY-Www.md   (markdown, comitável)
//
//  Scheduled: domingos 20:00 local (scheduled task dedicada).
// ─────────────────────────────────────────────────────────────────

import db from "../src/storage/db.js";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getSnapshots, getWeeklyPnl, getOpenTrades, getTradeHistory } from "../src/storage/trades.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── CLI args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => {
  const m = args.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split("=").slice(1).join("=") : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const weeksBack = parseInt(getArg("weeks") || "1");
const sinceArg  = getArg("since");
const QUIET     = hasFlag("quiet");

// ── Constants ───────────────────────────────────────────────────
const INTERVAL = "1h";
const MAX_DAYS_PER_SIGNAL = 7;
const MS_PER_HOUR = 3600 * 1000;

// ── Colors (silenciados se --quiet) ─────────────────────────────
const noColor = QUIET;
const C = {
  red:    (s) => noColor ? s : `\x1b[31m${s}\x1b[0m`,
  green:  (s) => noColor ? s : `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => noColor ? s : `\x1b[33m${s}\x1b[0m`,
  grey:   (s) => noColor ? s : `\x1b[90m${s}\x1b[0m`,
  cyan:   (s) => noColor ? s : `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => noColor ? s : `\x1b[1m${s}\x1b[0m`,
};

const log = (...xs) => { if (!QUIET) console.log(...xs); };

// ── Window calculation ──────────────────────────────────────────
function computeWindow() {
  const now = new Date();
  let from;
  if (sinceArg) {
    from = new Date(sinceArg + "T00:00:00Z");
  } else {
    from = new Date(now);
    from.setUTCDate(now.getUTCDate() - 7 * weeksBack);
  }
  return { from, to: now };
}

function isoWeek(d) {
  // ISO 8601 week number
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return { year: dt.getUTCFullYear(), week: weekNo };
}

// ── Fetch Binance klines (mesma lógica do counterfactual) ───────
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

// ── Simulate one signal (mesma lógica do counterfactual) ────────
function simulate(signal, bars) {
  const { direction, entry, sl, tp1, risk_dollars } = signal;
  const slDist  = Math.abs(entry - sl);
  const tp1Dist = Math.abs(tp1 - entry);
  const rMultiple = slDist > 0 ? tp1Dist / slDist : 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    let hitSl = false;
    let hitTp1 = false;
    if (direction === "LONG") {
      if (bar.low  <= sl)  hitSl  = true;
      if (bar.high >= tp1) hitTp1 = true;
    } else {
      if (bar.high >= sl)  hitSl  = true;
      if (bar.low  <= tp1) hitTp1 = true;
    }
    if (hitSl) {
      return { outcome: "LOSS", hoursToOutcome: i + 1, hypoPnl: -risk_dollars, rMultiple };
    }
    if (hitTp1) {
      return { outcome: "WIN", hoursToOutcome: i + 1, hypoPnl: risk_dollars * rMultiple, rMultiple };
    }
  }
  return {
    outcome: bars.length === 0 ? "NO_DATA" : "OPEN",
    hoursToOutcome: bars.length,
    hypoPnl: 0,
    rMultiple,
  };
}

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

// Agrupamento por (setup_id, direction) — mesmo shape do
// counterfactual-by-setup.js pra facilitar leitura cruzada.
function aggregateBySetup(results) {
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
        scoreSum: 0,
      };
    }
    const g = groups[key];
    g.count++;
    g.scoreSum += r.signal.score;
    if (r.sim.outcome === "WIN")     { g.wins++;   g.totalPnl += r.sim.hypoPnl; }
    if (r.sim.outcome === "LOSS")    { g.losses++; g.totalPnl += r.sim.hypoPnl; }
    if (r.sim.outcome === "OPEN")      g.open++;
    if (r.sim.outcome === "NO_DATA")   g.noData++;
  }
  return groups;
}

// ── Query signals da janela ─────────────────────────────────────
function loadWeekSignals(fromIso) {
  return db
    .prepare(
      `SELECT * FROM signals
        WHERE datetime(created_at) >= datetime(?)
          AND status != 'SUPERSEDED'
        ORDER BY created_at DESC`
    )
    .all(fromIso);
}

function countSignalsByStatus(fromIso) {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
         FROM signals
        WHERE datetime(created_at) >= datetime(?)
        GROUP BY status`
    )
    .all(fromIso);
  const out = { APPROVED: 0, PENDING_APPROVAL: 0, BELOW_THRESHOLD: 0, SUPERSEDED: 0, REJECTED: 0, EXPIRED: 0 };
  for (const r of rows) out[r.status] = r.count;
  return out;
}

// ── Recomendação MIN_SCORE ──────────────────────────────────────
function recommendMinScore(buckets) {
  const order = ["<60", "60-65", "65-70", "70-75", "75-80", "80+"];
  const safe = [];
  for (const k of order) {
    const b = buckets[k];
    if (!b) continue;
    const resolved = b.wins + b.losses;
    if (resolved < 2) continue; // amostra insuficiente
    const wr = (b.wins / resolved) * 100;
    const exp = b.totalPnl / resolved;
    if (wr >= 50 && exp > 0) safe.push(k);
  }
  if (safe.length === 0) {
    return {
      rec: null,
      reason: "Sem buckets com win rate >= 50% e expectancy > 0 (amostra pequena ou resultado fraco).",
    };
  }
  // menor bucket seguro define MIN_SCORE
  const first = safe[0];
  const mins = { "<60": 55, "60-65": 60, "65-70": 65, "70-75": 70, "75-80": 75, "80+": 80 };
  return {
    rec: mins[first],
    reason: `Primeiro bucket confiável (WR >= 50% e E > 0): ${first}.`,
    safeBuckets: safe,
  };
}

// ── Markdown builder ────────────────────────────────────────────
function buildMarkdown(ctx) {
  const {
    from, to, weekLabel, snapshots, currentCapital, capitalDelta,
    openTrades, closedTrades, weekPnl, sigCount, signals, buckets, setupGroups, recommendation,
  } = ctx;

  const lines = [];
  lines.push(`# Relatório Semanal — ${weekLabel}`);
  lines.push("");
  lines.push(`**Janela:** ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`);
  lines.push(`**Gerado em:** ${new Date().toISOString()}`);
  lines.push("");

  // ── Capital ────────────────────────────────────────────────
  lines.push("## Capital");
  lines.push("");
  if (currentCapital != null) {
    const sign = capitalDelta >= 0 ? "+" : "";
    lines.push(`- Capital atual: **$${currentCapital.toFixed(2)} USDC**`);
    lines.push(`- Variação na janela: **${sign}$${capitalDelta.toFixed(2)}**`);
  } else {
    lines.push(`- Sem snapshots ainda.`);
  }
  if (snapshots.length > 1) {
    lines.push("");
    lines.push("| Data | Capital |");
    lines.push("|------|---------|");
    for (const s of snapshots) {
      lines.push(`| ${s.date} | $${Number(s.capital).toFixed(2)} |`);
    }
  }
  lines.push("");

  // ── Trades ─────────────────────────────────────────────────
  lines.push("## Trades");
  lines.push("");
  lines.push(`- P&L realizado semana: **$${weekPnl.pnl.toFixed(2)}** (${weekPnl.tradeCount} trades)`);
  lines.push(`- Abertos agora: ${openTrades.length}`);
  lines.push(`- Fechados (histórico): ${closedTrades.length}`);
  lines.push("");

  if (openTrades.length > 0) {
    lines.push("### Trades abertos");
    lines.push("");
    lines.push("| ID | Signal | Symbol | Dir | Entry | SL | TP1 | Size | Abriu em |");
    lines.push("|----|--------|--------|-----|-------|-----|-----|------|----------|");
    for (const t of openTrades) {
      lines.push(
        `| ${t.id} | #${t.signal_id} | ${t.symbol} | ${t.direction} | ` +
        `$${Number(t.entry_price).toFixed(2)} | $${Number(t.sl).toFixed(2)} | ` +
        `$${Number(t.tp1).toFixed(2)} | ${Number(t.size).toFixed(4)} | ${t.opened_at} |`
      );
    }
    lines.push("");
  }

  if (closedTrades.length > 0) {
    lines.push("### Trades fechados (histórico recente)");
    lines.push("");
    lines.push("| ID | Symbol | Dir | Entry | Exit | P&L | Close | Fechou em |");
    lines.push("|----|--------|-----|-------|------|-----|-------|-----------|");
    for (const t of closedTrades) {
      const pnl = t.pnl != null ? `$${Number(t.pnl).toFixed(2)}` : "—";
      lines.push(
        `| ${t.id} | ${t.symbol} | ${t.direction} | ` +
        `$${Number(t.entry_price).toFixed(2)} | ${t.exit_price != null ? "$" + Number(t.exit_price).toFixed(2) : "—"} | ` +
        `${pnl} | ${t.close_reason ?? "—"} | ${t.closed_at ?? "—"} |`
      );
    }
    lines.push("");
  }

  // ── Signals por status ─────────────────────────────────────
  lines.push("## Signals na janela");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("|--------|-------|");
  for (const [k, v] of Object.entries(sigCount)) {
    if (v > 0) lines.push(`| ${k} | ${v} |`);
  }
  lines.push("");

  // ── Counterfactual ─────────────────────────────────────────
  lines.push("## Counterfactual (H1 replay, até 7d/sinal)");
  lines.push("");
  if (signals.length === 0) {
    lines.push("_Nenhum sinal elegível na janela (SUPERSEDED excluído)._");
  } else {
    lines.push(`Processados **${signals.length}** sinal(is) não-supersedidos.`);
    lines.push("");
    lines.push("### Agregação por bucket de score");
    lines.push("");
    lines.push("| Bucket | Count | Wins | Losses | Open/NoData | Win% | Total P&L | Expectancy |");
    lines.push("|--------|-------|------|--------|-------------|------|-----------|------------|");
    const order = ["<60", "60-65", "65-70", "70-75", "75-80", "80+"];
    for (const k of order) {
      const b = buckets[k];
      if (!b) continue;
      const resolved = b.wins + b.losses;
      const wr  = resolved > 0 ? (b.wins / resolved) * 100 : 0;
      const exp = resolved > 0 ? b.totalPnl / resolved : 0;
      lines.push(
        `| ${k} | ${b.count} | ${b.wins} | ${b.losses} | ${b.open + b.noData} | ` +
        `${wr.toFixed(1)}% | $${b.totalPnl.toFixed(2)} | $${exp.toFixed(2)} |`
      );
    }
    lines.push("");
    lines.push("### Agregação por setup × direction");
    lines.push("");
    lines.push("| Setup | Dir | N | W | L | Open | Win% | Total P&L | Expectancy | AvgScore |");
    lines.push("|-------|-----|---|---|---|------|------|-----------|------------|----------|");
    const setupKeys = Object.keys(setupGroups).sort((a, b) => {
      const ga = setupGroups[a], gb = setupGroups[b];
      const ea = (ga.wins + ga.losses) > 0 ? ga.totalPnl / (ga.wins + ga.losses) : -Infinity;
      const eb = (gb.wins + gb.losses) > 0 ? gb.totalPnl / (gb.wins + gb.losses) : -Infinity;
      return eb - ea;
    });
    for (const k of setupKeys) {
      const g = setupGroups[k];
      const resolved = g.wins + g.losses;
      const wr  = resolved > 0 ? (g.wins / resolved) * 100 : 0;
      const exp = resolved > 0 ? g.totalPnl / resolved : 0;
      const avgScore = g.count > 0 ? g.scoreSum / g.count : 0;
      lines.push(
        `| ${g.setup_id} | ${g.direction} | ${g.count} | ${g.wins} | ${g.losses} | ` +
        `${g.open + g.noData} | ${wr.toFixed(1)}% | $${g.totalPnl.toFixed(2)} | ` +
        `$${exp.toFixed(2)} | ${avgScore.toFixed(1)} |`
      );
    }
    lines.push("");
    lines.push("### Detalhe por sinal");
    lines.push("");
    lines.push("| ID | Data | Sym | Dir | Score | Status | Outcome | Hours | P&L | R |");
    lines.push("|----|------|-----|-----|-------|--------|---------|-------|-----|---|");
    // top 20 mais recentes
    for (const r of ctx.signalResults.slice(0, 20)) {
      const s = r.signal;
      const pnl = r.sim.hypoPnl;
      const pnlStr =
        pnl > 0 ? `+$${pnl.toFixed(2)}` :
        pnl < 0 ? `-$${Math.abs(pnl).toFixed(2)}` : "—";
      lines.push(
        `| ${s.id} | ${s.created_at.slice(0, 10)} | ${s.symbol} | ${s.direction} | ` +
        `${s.score.toFixed(0)} | ${s.status} | ${r.sim.outcome} | ${r.sim.hoursToOutcome} | ${pnlStr} | ${r.sim.rMultiple.toFixed(2)} |`
      );
    }
    if (ctx.signalResults.length > 20) {
      lines.push("");
      lines.push(`_(${ctx.signalResults.length - 20} sinal(is) mais antigos omitidos — veja CSV via \`--csv\` no counterfactual.)_`);
    }
  }
  lines.push("");

  // ── Recomendação ───────────────────────────────────────────
  lines.push("## Recomendação MIN_SCORE");
  lines.push("");
  if (recommendation.rec != null) {
    lines.push(`**Recomendado:** MIN_SCORE = ${recommendation.rec}`);
    lines.push("");
    lines.push(`- Razão: ${recommendation.reason}`);
    lines.push(`- Buckets seguros observados: ${recommendation.safeBuckets.join(", ")}`);
  } else {
    lines.push(`**Sem recomendação confiável.**`);
    lines.push("");
    lines.push(`- Razão: ${recommendation.reason}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("_Gerado automaticamente por \`scripts/weekly-report.js\`. Mudar `MIN_SCORE` em `src/config/strategy.js` requer aprovação explícita conforme governança._");
  lines.push("");

  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  const { from, to } = computeWindow();
  const fromIso = from.toISOString().replace("T", " ").slice(0, 19);

  log(C.bold("\n═══ Weekly report ═══"));
  log(C.grey(`  Janela: ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`));

  // Snapshots + capital
  const allSnapshots = getSnapshots(60);
  const snapshots = allSnapshots.filter((s) => new Date(s.date) >= from);
  const currentCapital = allSnapshots.length ? Number(allSnapshots[allSnapshots.length - 1].capital) : null;
  const firstInWindow  = snapshots[0] ? Number(snapshots[0].capital) : currentCapital;
  const capitalDelta   = (currentCapital != null && firstInWindow != null) ? currentCapital - firstInWindow : 0;

  // Trades
  const openTrades   = getOpenTrades();
  const closedTrades = getTradeHistory(50).filter((t) => {
    if (!t.closed_at) return false;
    return new Date(t.closed_at) >= from;
  });
  const weekPnl = getWeeklyPnl();

  // Signals
  const sigCount = countSignalsByStatus(fromIso);
  const signals  = loadWeekSignals(fromIso);
  log(C.grey(`  Signals elegíveis: ${signals.length}`));

  // Counterfactual
  const signalResults = [];
  for (const s of signals) {
    const startMs = new Date(s.created_at).getTime();
    const endMs   = Math.min(Date.now(), startMs + MAX_DAYS_PER_SIGNAL * 24 * MS_PER_HOUR);
    let bars = [];
    try {
      bars = await fetchKlinesRange(s.symbol, INTERVAL, startMs, endMs);
    } catch (err) {
      log(C.yellow(`  ⚠ signal #${s.id} — fetch falhou: ${err.message}`));
    }
    const sim = simulate(s, bars);
    signalResults.push({ signal: s, sim });
    await new Promise((r) => setTimeout(r, 100)); // rate-limit
  }

  const buckets = aggregate(signalResults);
  const setupGroups = aggregateBySetup(signalResults);
  const recommendation = recommendMinScore(buckets);

  // Label YYYY-Www
  const { year, week } = isoWeek(to);
  const weekLabel = `${year}-W${String(week).padStart(2, "0")}`;

  const md = buildMarkdown({
    from, to, weekLabel,
    snapshots, currentCapital, capitalDelta,
    openTrades, closedTrades, weekPnl,
    sigCount, signals, signalResults, buckets, setupGroups, recommendation,
  });

  // Write file
  mkdirSync(resolve(ROOT, "data/reports"), { recursive: true });
  const path = resolve(ROOT, `data/reports/weekly-${weekLabel}.md`);
  writeFileSync(path, md);
  log(C.green(`\n✓ Relatório gravado em ${path}`));
  log(C.grey(`  (${md.split("\n").length} linhas, ${md.length} chars)`));

  // Resumo no console
  if (!QUIET) {
    console.log();
    console.log(C.bold("Resumo:"));
    console.log(`  Capital:       ${currentCapital != null ? "$" + currentCapital.toFixed(2) : "—"}`);
    console.log(`  Δ na janela:   ${capitalDelta >= 0 ? "+" : ""}$${capitalDelta.toFixed(2)}`);
    console.log(`  Trades abertos: ${openTrades.length}`);
    console.log(`  Trades fechados na janela: ${closedTrades.length}`);
    console.log(`  P&L semanal:   $${weekPnl.pnl.toFixed(2)}`);
    console.log(`  Signals totais: ${Object.values(sigCount).reduce((a, b) => a + b, 0)}`);
    console.log(`  MIN_SCORE sugerido: ${recommendation.rec != null ? recommendation.rec : "(sem recomendação)"}`);
  }
}

main().catch((err) => {
  console.error(C.red(`\n✗ Erro: ${err.message}`));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
