// ─────────────────────────────────────────────────────────────────
//  explain-signal.js — Narra um signal específico em markdown
//
//  Dado um signal ID, monta um documento markdown completo com:
//    • Header (signal #, symbol, direction, score, setup, status, trade link)
//    • Contexto temporal (created_at, e se abriu trade, open/close times)
//    • Outcome contrafactual (H1 replay, 7d) se não tiver trade real ainda
//    • Trade math (entry, SL, TPs, R-multiple, risk $, position sizing, scale entries)
//    • Rationale (bullets do scoring engine)
//    • Técnicos D1/W1 (EMA200, EMA21, MACD, RSI, StochRSI)
//    • On-chain (funding, long/short, OI)
//    • Macro (fear-greed, bias)
//    • Setups avaliados (quais dispararam + confidence de cada)
//
//  Usage:
//    node scripts/explain-signal.js --id=3                 (stdout)
//    node scripts/explain-signal.js --id=3 --save          (research/signals/signal-3.md)
//    node scripts/explain-signal.js --id=3 --json          (row parseado bruto)
//    node scripts/explain-signal.js --id=3 --no-counterfactual
// ─────────────────────────────────────────────────────────────────

import db from "../src/storage/db.js";
import { getSignal } from "../src/storage/trades.js";
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

const signalId = parseInt(getArg("id"));
const SAVE     = hasFlag("save");
const JSON_OUT = hasFlag("json");
const SKIP_CF  = hasFlag("no-counterfactual");

const C = {
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  grey:   (s) => `\x1b[90m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
};

// ── Counterfactual helpers (mesma lógica do counterfactual.js) ──
const INTERVAL = "1h";
const MAX_DAYS = 7;
const MS_PER_HOUR = 3600 * 1000;

async function fetchKlinesRange(symbol, interval, startMs, endMs) {
  const url =
    `https://api.binance.com/api/v3/klines?symbol=${symbol}` +
    `&interval=${interval}&startTime=${startMs}&endTime=${endMs}&limit=1000`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Binance HTTP ${res.status}`);
  }
  const raw = await res.json();
  return raw.map(([time, open, high, low, close]) => ({
    time: Math.floor(time / 1000),
    open: parseFloat(open),
    high: parseFloat(high),
    low:  parseFloat(low),
    close: parseFloat(close),
  }));
}

function simulateOutcome(signal, bars) {
  const { direction, entry, sl, tp1, risk_dollars } = signal;
  const slDist  = Math.abs(entry - sl);
  const tp1Dist = Math.abs(tp1 - entry);
  const rMultiple = slDist > 0 ? tp1Dist / slDist : 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    let hitSl = false, hitTp1 = false;
    if (direction === "LONG") {
      if (bar.low <= sl)   hitSl = true;
      if (bar.high >= tp1) hitTp1 = true;
    } else {
      if (bar.high >= sl)  hitSl = true;
      if (bar.low <= tp1)  hitTp1 = true;
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

// ── Trade lookup (se o signal virou trade real) ─────────────────
function getLinkedTrade(signalId) {
  return db.prepare(`SELECT * FROM trades WHERE signal_id = ? ORDER BY id DESC LIMIT 1`).get(signalId);
}

// ── Supersede lookup ────────────────────────────────────────────
function getSupersedingSignal(signal) {
  if (!signal.superseded_by) return null;
  return db.prepare(`SELECT id, symbol, direction, score, status, created_at FROM signals WHERE id = ?`).get(signal.superseded_by);
}

// ── Helpers ─────────────────────────────────────────────────────
function fmtNum(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return Number(v).toFixed(digits);
}
function fmtPct(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Number(v).toFixed(digits)}%`;
}
function fmtUsd(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return `$${Number(v).toFixed(digits)}`;
}
function safeParse(v) {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}

// ── Markdown builder ────────────────────────────────────────────
function buildNarrative(signal, trade, outcome, superseding) {
  const lines = [];
  const inputs = signal.inputs ?? {};
  const rationale = Array.isArray(signal.rationale) ? signal.rationale : safeParse(signal.rationale) ?? [];
  const scale = Array.isArray(signal.scale_entries) ? signal.scale_entries : safeParse(signal.scale_entries) ?? [];

  // R-multiple
  const slDist  = Math.abs(signal.entry - signal.sl);
  const tp1Dist = Math.abs(signal.tp1 - signal.entry);
  const rMultiple = slDist > 0 ? tp1Dist / slDist : null;

  // ── Header ────────────────────────────────────────────────
  // Fallback: se signal.setup_id for null (sinais antigos ou gravação
  // incompleta), pega o primeiro setup em inputs.allSetups na direção.
  const setupIdDisplay =
    signal.setup_id ??
    inputs.allSetups?.find((s) => s.direction === signal.direction)?.id ??
    "—";
  const setupNameDisplay = signal.setup_name ?? (setupIdDisplay !== "—" ? setupIdDisplay : "—");

  lines.push(`# Signal #${signal.id} — ${signal.symbol} ${signal.direction}`);
  lines.push("");
  lines.push(`**Score:** ${signal.score?.toFixed(1) ?? "—"} · **Setup:** ${setupIdDisplay} (${setupNameDisplay})`);
  lines.push(`**Status:** ${signal.status} · **Trade type:** ${signal.trade_type ?? "—"} · **Leverage:** ${signal.leverage ?? 1}x`);
  lines.push(`**Criado:** ${signal.created_at}`);
  if (signal.updated_at && signal.updated_at !== signal.created_at) {
    lines.push(`**Atualizado:** ${signal.updated_at}`);
  }
  lines.push("");

  // ── Estado atual ─────────────────────────────────────────
  lines.push("## Estado");
  lines.push("");
  if (trade) {
    lines.push(`- Signal virou **Trade #${trade.id}** (status: ${trade.status})`);
    lines.push(`- Entry fill: ${fmtUsd(trade.entry_price, 2)} · Size: ${fmtNum(trade.size, 4)}`);
    lines.push(`- Aberto em: ${trade.opened_at}${trade.closed_at ? ` · Fechado: ${trade.closed_at}` : ""}`);
    if (trade.closed_at) {
      lines.push(`- Exit: ${trade.exit_price != null ? fmtUsd(trade.exit_price, 2) : "—"} · ` +
                 `P&L: ${trade.pnl != null ? fmtUsd(trade.pnl, 2) : "—"} · Close: ${trade.close_reason ?? "—"}`);
    }
  } else if (signal.status === "SUPERSEDED" && superseding) {
    lines.push(`- Marcado **SUPERSEDED** por Signal #${superseding.id} ` +
               `(${superseding.symbol} ${superseding.direction}, score ${superseding.score?.toFixed(1)}, ${superseding.status})`);
  } else {
    lines.push(`- Nenhum trade real executado.`);
  }
  if (outcome) {
    const outColor =
      outcome.outcome === "WIN"  ? "✅ WIN" :
      outcome.outcome === "LOSS" ? "❌ LOSS" :
      outcome.outcome === "OPEN" ? "⏳ OPEN" : "⚠️ NO_DATA";
    lines.push(`- **Counterfactual (H1 replay):** ${outColor} em ${outcome.hoursToOutcome}h · ` +
               `P&L hipotético: ${fmtUsd(outcome.hypoPnl, 2)} · R = ${fmtNum(outcome.rMultiple, 2)}`);
  }
  lines.push("");

  // ── Trade math ────────────────────────────────────────────
  lines.push("## Níveis de preço e risco");
  lines.push("");
  lines.push("| Campo | Valor |");
  lines.push("|-------|-------|");
  lines.push(`| Preço no signal | ${fmtUsd(signal.price, 2)} |`);
  lines.push(`| Entry (1ª) | ${fmtUsd(signal.entry, 2)} |`);
  if (signal.avg_entry != null && Math.abs(signal.avg_entry - signal.entry) > 1e-6) {
    lines.push(`| Avg entry (scale) | ${fmtUsd(signal.avg_entry, 2)} |`);
  }
  lines.push(`| Stop-loss | ${fmtUsd(signal.sl, 2)} |`);
  lines.push(`| TP1 | ${fmtUsd(signal.tp1, 2)} |`);
  lines.push(`| TP2 | ${fmtUsd(signal.tp2, 2)} |`);
  lines.push(`| TP3 | ${fmtUsd(signal.tp3, 2)} |`);
  lines.push(`| R-multiple (TP1/SL) | ${rMultiple != null ? rMultiple.toFixed(2) : "—"} |`);
  lines.push(`| Position size | ${fmtNum(signal.position_size, 4)} |`);
  lines.push(`| Position value | ${fmtUsd(signal.position_value, 2)} |`);
  lines.push(`| Risk $ | ${fmtUsd(signal.risk_dollars, 2)} |`);
  lines.push("");

  // Scale entries (se houver mais de 1)
  if (scale.length > 1) {
    lines.push("### Scale-in entries");
    lines.push("");
    lines.push("| # | Preço | SL | Size | Value |");
    lines.push("|---|-------|----|------|-------|");
    for (const e of scale) {
      lines.push(`| ${e.index} | ${fmtUsd(e.price, 2)} | ${fmtUsd(e.sl_price, 2)} | ${fmtNum(e.size, 4)} | ${fmtUsd(e.value, 2)} |`);
    }
    lines.push("");
  }

  // ── Rationale ─────────────────────────────────────────────
  if (rationale.length > 0) {
    lines.push("## Rationale (do scoring engine)");
    lines.push("");
    for (const r of rationale) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }

  // ── Técnicos ──────────────────────────────────────────────
  const t = inputs.technical;
  if (t) {
    lines.push("## Técnicos");
    lines.push("");
    lines.push("| Indicador | Valor | Leitura |");
    lines.push("|-----------|-------|---------|");
    if (t.price != null)
      lines.push(`| Preço | ${fmtUsd(t.price, 2)} | referência do signal |`);
    if (t.ema200d != null)
      lines.push(`| EMA200 D1 | ${fmtUsd(t.ema200d, 2)} | preço ${t.price > t.ema200d ? "acima (bullish macro)" : "abaixo (bearish macro)"} |`);
    if (t.ema21w != null)
      lines.push(`| EMA21 W1 | ${fmtUsd(t.ema21w, 2)} | tendência semanal ${t.price > t.ema21w ? "favorece long" : "favorece short"} |`);
    if (t.macd?.histogram != null) {
      const dir = t.macd.histogram > 0 ? "bullish" : "bearish";
      lines.push(`| MACD W1 hist | ${fmtNum(t.macd.histogram, 4)} | momentum ${dir} |`);
    }
    if (t.rsiW != null) {
      let zone = "neutra";
      if (t.rsiW > 70) zone = "sobrecomprado";
      else if (t.rsiW < 30) zone = "sobrevendido";
      lines.push(`| RSI W1 | ${fmtNum(t.rsiW, 1)} | zona ${zone} |`);
    }
    if (t.stochRsiW?.k != null)
      lines.push(`| StochRSI W1 K | ${fmtNum(t.stochRsiW.k, 1)} | — |`);
    lines.push("");
  }

  // ── On-chain ──────────────────────────────────────────────
  const oc = inputs.onchain;
  if (oc) {
    lines.push("## On-chain");
    lines.push("");
    lines.push("| Campo | Valor |");
    lines.push("|-------|-------|");
    if (oc.funding) {
      const fr = oc.funding.rate != null ? fmtPct(oc.funding.rate * 100, 4) : "—";
      lines.push(`| Funding rate | ${fr} (${oc.funding.bias ?? "—"}) |`);
    }
    if (oc.longShort) {
      lines.push(`| Long/Short ratio | ${fmtNum(oc.longShort.ratio, 2)} (${oc.longShort.bias ?? "—"}) |`);
    }
    if (oc.openInterest) {
      lines.push(`| Open Interest | ${fmtUsd(oc.openInterest.value, 0)} (${oc.openInterest.change24h != null ? fmtPct(oc.openInterest.change24h, 2) : "—"} 24h) |`);
    }
    lines.push("");
  }

  // ── Macro ─────────────────────────────────────────────────
  const m = inputs.macro;
  if (m) {
    lines.push("## Macro");
    lines.push("");
    lines.push("| Campo | Valor |");
    lines.push("|-------|-------|");
    if (m.fearGreed) {
      lines.push(`| Fear & Greed | ${m.fearGreed.value}/100 (${m.fearGreed.classification ?? "—"}) |`);
    }
    if (m.overallBias) {
      lines.push(`| Overall bias (rules.json) | ${m.overallBias} |`);
    }
    lines.push("");
  }

  // ── Setups avaliados ──────────────────────────────────────
  if (Array.isArray(inputs.allSetups) && inputs.allSetups.length > 0) {
    lines.push("## Setups disparados");
    lines.push("");
    lines.push("| Setup | Direction | Confidence |");
    lines.push("|-------|-----------|------------|");
    for (const s of inputs.allSetups) {
      const marker = s.id === setupIdDisplay && s.direction === signal.direction ? " ✅" : "";
      lines.push(`| ${s.id}${marker} | ${s.direction} | ${fmtNum(s.confidence, 1)} |`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(`_Gerado por \`scripts/explain-signal.js --id=${signal.id}\` em ${new Date().toISOString()}._`);
  lines.push("");
  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  if (!signalId || Number.isNaN(signalId)) {
    console.error(C.red("Uso: node scripts/explain-signal.js --id=<signal_id> [--save] [--json] [--no-counterfactual]"));
    process.exit(1);
  }

  const signal = getSignal(signalId);
  if (!signal) {
    console.error(C.red(`✗ Signal #${signalId} não existe.`));
    process.exit(1);
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(signal, null, 2));
    return;
  }

  const trade       = getLinkedTrade(signalId);
  const superseding = getSupersedingSignal(signal);

  // Outcome contrafactual (opcional)
  let outcome = null;
  if (!SKIP_CF) {
    try {
      const startMs = new Date(signal.created_at).getTime();
      const endMs   = Math.min(Date.now(), startMs + MAX_DAYS * 24 * MS_PER_HOUR);
      const bars = await fetchKlinesRange(signal.symbol, INTERVAL, startMs, endMs);
      outcome = simulateOutcome(signal, bars);
    } catch (err) {
      console.warn(C.yellow(`  ⚠ Counterfactual fetch falhou: ${err.message}`));
    }
  }

  const md = buildNarrative(signal, trade, outcome, superseding);

  if (SAVE) {
    mkdirSync(resolve(ROOT, "research/signals"), { recursive: true });
    const path = resolve(ROOT, `research/signals/signal-${signalId}.md`);
    writeFileSync(path, md);
    console.log(C.green(`✓ Narrativa gravada em ${path}`));
    console.log(C.grey(`  (${md.split("\n").length} linhas, ${md.length} chars)`));
  } else {
    // stdout puro (sem cores) pra redirecionar facilmente
    process.stdout.write(md);
  }
}

main().catch((err) => {
  console.error(C.red(`\n✗ Erro: ${err.message}`));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
