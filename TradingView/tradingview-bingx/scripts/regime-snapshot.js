// ─────────────────────────────────────────────────────────────────
//  regime-snapshot.js — Snapshot do regime de mercado (BTC + ETH)
//
//  Pega em tempo real:
//    • BTC: preço, EMA200 D1 (daily), EMA21 W1 (weekly), MACD W1 hist, RSI W1
//    • ETH: preço, EMA200 D1 (daily), EMA21 W1 (weekly), MACD W1 hist, RSI W1
//    • Fear & Greed index (CoinGlass)
//    • Funding rate médio (BingX, via analyzeOnChain se disponível)
//    • rules.json overall_bias
//
//  Classifica o regime em bull / chop / bear por símbolo, agrega bias,
//  e imprime 1 linha por símbolo + 1 resumo macro.
//
//  Compara com rules.json e sinaliza divergência:
//    • Se BTC real está bull e rules.json diz "bearish" → flag
//    • Se fear-greed real diverge de rules.json em mais de 15 pontos → flag
//
//  NÃO altera rules.json sozinho (governança). Só sugere edição manual.
//
//  Usage:
//    node scripts/regime-snapshot.js                (stdout)
//    node scripts/regime-snapshot.js --save         (salva em research/snapshots/YYYY-MM-DD.md)
//    node scripts/regime-snapshot.js --json         (JSON bruto)
// ─────────────────────────────────────────────────────────────────

import { analyzeTechnical, createBinanceAdapter } from "../src/analysis/technical.js";
import { analyzeMacro } from "../src/analysis/macro.js";
import { getLatestOnchainSnapshot } from "../src/storage/trades.js";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── CLI args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(`--${n}`);
const SAVE = hasFlag("save");
const JSON_OUT = hasFlag("json");

const C = {
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  grey:   (s) => `\x1b[90m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
};

const SYMBOLS = ["BTCUSDC", "ETHUSDC"];

// ── Regime classifier ──────────────────────────────────────────
function classifyRegime(tech) {
  const { price, daily, weekly } = tech;
  const ema200   = daily?.ema200;
  const ema21w   = weekly?.ema21;
  const macdHist = weekly?.macd?.histogram;
  const rsiW     = weekly?.rsi;

  // Pontuação: cada sinal contribui +1 bullish, -1 bearish, 0 neutro
  let score = 0;
  const notes = [];

  if (ema200 != null) {
    if (price > ema200) { score += 1; notes.push("preço > EMA200 D1 (bull bias macro)"); }
    else                { score -= 1; notes.push("preço < EMA200 D1 (bear bias macro)"); }
  }
  if (ema21w != null) {
    if (price > ema21w) { score += 1; notes.push("preço > EMA21 W1 (tendência semanal acima)"); }
    else                { score -= 1; notes.push("preço < EMA21 W1 (tendência semanal abaixo)"); }
  }
  if (macdHist != null) {
    if (macdHist > 0)   { score += 1; notes.push(`MACD W1 hist > 0 (momentum bullish, ${macdHist.toFixed(4)})`); }
    else                { score -= 1; notes.push(`MACD W1 hist < 0 (momentum bearish, ${macdHist.toFixed(4)})`); }
  }
  if (rsiW != null) {
    if (rsiW > 55)      { score += 1; notes.push(`RSI W1 ${rsiW.toFixed(1)} (>55 bullish)`); }
    else if (rsiW < 45) { score -= 1; notes.push(`RSI W1 ${rsiW.toFixed(1)} (<45 bearish)`); }
    else                {              notes.push(`RSI W1 ${rsiW.toFixed(1)} (neutro)`); }
  }

  let regime, label;
  if (score >= 2)       { regime = "bull"; label = C.green("BULL"); }
  else if (score <= -2) { regime = "bear"; label = C.red("BEAR"); }
  else                   { regime = "chop"; label = C.yellow("CHOP"); }

  return { regime, label, score, notes };
}

// ── Compare vs rules.json ──────────────────────────────────────
// Lê o bloco `market_context_YYYY_MM_DD` mais recente (mesma lógica de
// src/analysis/macro.js). Fallback pra `market_context` raiz se não houver
// bloco datado — mantém compat com rules.json antigos.
function loadRulesBias() {
  try {
    const raw = readFileSync(resolve(ROOT, "rules.json"), "utf-8");
    const json = JSON.parse(raw);

    // Procura o bloco datado mais recente
    const datedKey = Object.keys(json)
      .filter((k) => k.startsWith("market_context_"))
      .sort()
      .pop();
    const ctx = datedKey ? json[datedKey] : json.market_context;

    return {
      overall: (ctx?.overall_bias ?? "unknown").toLowerCase(),
      fearGreedRules: ctx?.fear_greed_index ?? null,
      lastUpdated: ctx?.last_updated ?? null,
      sourceKey: datedKey ?? "market_context",
    };
  } catch {
    return { overall: "unknown", fearGreedRules: null, lastUpdated: null, sourceKey: "market_context" };
  }
}

function detectDivergences(regimes, fearGreedNow, rulesBias) {
  const flags = [];

  // BTC regime vs rules.json overall_bias
  const btcRegime = regimes.BTCUSDC?.regime;
  const bias = rulesBias.overall;
  if (btcRegime && bias !== "unknown" && bias !== "neutral") {
    if (btcRegime === "bull" && bias === "bearish") {
      flags.push(`rules.json diz "${bias}" mas BTC está BULL — considere atualizar rules.json.market_context.overall_bias`);
    }
    if (btcRegime === "bear" && bias === "bullish") {
      flags.push(`rules.json diz "${bias}" mas BTC está BEAR — considere atualizar rules.json.market_context.overall_bias`);
    }
  }

  // Fear & Greed real vs rules.json
  if (fearGreedNow != null && rulesBias.fearGreedRules != null) {
    const diff = Math.abs(fearGreedNow - rulesBias.fearGreedRules);
    if (diff >= 15) {
      flags.push(
        `Fear & Greed atual ${fearGreedNow} vs rules.json ${rulesBias.fearGreedRules} ` +
        `(diff ${diff} pontos) — considere atualizar rules.json.market_context.fear_greed_index`
      );
    }
  }

  // rules.json last_updated muito antigo (>7 dias)
  if (rulesBias.lastUpdated) {
    const daysOld = (Date.now() - new Date(rulesBias.lastUpdated).getTime()) / (86400 * 1000);
    if (daysOld > 7) {
      flags.push(`rules.json.market_context.last_updated = ${rulesBias.lastUpdated} (${daysOld.toFixed(0)}d atrás) — está desatualizado`);
    }
  } else {
    flags.push(`rules.json.market_context.last_updated está vazio — nunca atualizado`);
  }

  return flags;
}

// ── Render ─────────────────────────────────────────────────────
function renderConsole(snapshot) {
  const { regimes, macro, rulesBias, divergences } = snapshot;

  console.log();
  console.log(C.bold("═══ Regime Snapshot ═══"));
  console.log(C.grey(`  ${new Date().toISOString()}`));
  console.log();

  // Por símbolo
  for (const sym of SYMBOLS) {
    const r = regimes[sym];
    if (!r) {
      console.log(`  ${sym.padEnd(9)}  ${C.yellow("—")}  (sem dados)`);
      continue;
    }
    const price = r.tech.price.toFixed(2);
    console.log(`  ${sym.padEnd(9)}  ${r.label}  $${price}  (score ${r.score >= 0 ? "+" : ""}${r.score})`);
    for (const n of r.notes) console.log(C.grey(`     • ${n}`));
    console.log();
  }

  // Macro
  const fgVal = macro?.fearGreed?.value;
  const fgLabel = macro?.fearGreed?.label;
  console.log(C.bold("Macro:"));
  console.log(`  Fear & Greed: ${fgVal ?? "?"}/100 (${fgLabel ?? "—"}, source: ${macro?.fearGreed?.source ?? "—"})`);
  console.log(`  rules.json overall_bias: ${rulesBias.overall}`);
  console.log(`  rules.json last_updated: ${rulesBias.lastUpdated ?? "(vazio)"}`);
  console.log();

  // On-chain (último snapshot persistido) — observability, não scoring
  const onchainBtc = snapshot.onchain?.BTCUSDC;
  if (onchainBtc) {
    console.log(C.bold("On-chain (BTC, último snapshot):"));
    const fmtPrice = (v) => v != null ? `$${Number(v).toLocaleString()}` : "—";
    const fmtMvrv  = (v) => v != null ? Number(v).toFixed(2) : "—";
    console.log(`  MVRV (price/realized): ${fmtMvrv(onchainBtc.mvrv)}`);
    console.log(`  Realized Price:        ${fmtPrice(onchainBtc.realized_price)}`);
    console.log(`  STH Realized Price:    ${fmtPrice(onchainBtc.sth_rp)}`);
    console.log(`  LTH Realized Price:    ${fmtPrice(onchainBtc.lth_rp)}`);
    console.log(`  CVDD:                  ${fmtPrice(onchainBtc.cvdd)}`);
    console.log(C.grey(`  capturado em: ${onchainBtc.captured_at}`));
    console.log();
  } else {
    console.log(C.grey("On-chain (BTC): nenhum snapshot persistido ainda — scanner precisa rodar pelo menos 1 ciclo"));
    console.log();
  }

  // Divergências
  if (divergences.length === 0) {
    console.log(C.green("✓ Sem divergências entre snapshot real e rules.json"));
  } else {
    console.log(C.yellow(C.bold("⚠ Divergências detectadas:")));
    for (const d of divergences) console.log(C.yellow(`  • ${d}`));
    console.log();
    console.log(C.cyan("  Ação sugerida: revisar e atualizar rules.json manualmente (é edição livre, sem governança)."));
  }
  console.log();
}

function buildMarkdown(snapshot) {
  const { regimes, macro, rulesBias, divergences } = snapshot;
  const lines = [];
  const stamp = new Date().toISOString().slice(0, 10);
  lines.push(`# Regime Snapshot — ${stamp}`);
  lines.push("");
  lines.push(`**Gerado em:** ${new Date().toISOString()}`);
  lines.push("");

  lines.push("## Por símbolo");
  lines.push("");
  lines.push("| Symbol | Regime | Score | Preço | EMA200 D1 | EMA21 W1 | MACD W1 hist | RSI W1 |");
  lines.push("|--------|--------|-------|-------|-----------|----------|--------------|--------|");
  for (const sym of SYMBOLS) {
    const r = regimes[sym];
    if (!r) { lines.push(`| ${sym} | — | — | — | — | — | — | — |`); continue; }
    const t = r.tech;
    lines.push(
      `| ${sym} | ${r.regime.toUpperCase()} | ${r.score >= 0 ? "+" : ""}${r.score} | ` +
      `$${t.price?.toFixed(2) ?? "—"} | ` +
      `${t.daily?.ema200 != null ? "$" + t.daily.ema200.toFixed(2) : "—"} | ` +
      `${t.weekly?.ema21 != null ? "$" + t.weekly.ema21.toFixed(2) : "—"} | ` +
      `${t.weekly?.macd?.histogram != null ? t.weekly.macd.histogram.toFixed(4) : "—"} | ` +
      `${t.weekly?.rsi != null ? t.weekly.rsi.toFixed(1) : "—"} |`
    );
  }
  lines.push("");

  // Notes por símbolo
  for (const sym of SYMBOLS) {
    const r = regimes[sym];
    if (!r || r.notes.length === 0) continue;
    lines.push(`### ${sym} — leitura`);
    lines.push("");
    for (const n of r.notes) lines.push(`- ${n}`);
    lines.push("");
  }

  lines.push("## Macro");
  lines.push("");
  lines.push("| Campo | Valor |");
  lines.push("|-------|-------|");
  lines.push(`| Fear & Greed | ${macro?.fearGreed?.value ?? "?"}/100 (${macro?.fearGreed?.label ?? "—"}, ${macro?.fearGreed?.source ?? "—"}) |`);
  lines.push(`| rules.json overall_bias | ${rulesBias.overall} |`);
  lines.push(`| rules.json last_updated | ${rulesBias.lastUpdated ?? "(vazio)"} |`);
  lines.push("");

  // On-chain
  const onchainBtc = snapshot.onchain?.BTCUSDC;
  if (onchainBtc) {
    lines.push("## On-chain (último snapshot persistido)");
    lines.push("");
    lines.push("| Métrica | BTC |");
    lines.push("|---------|-----|");
    const f = (v, prefix = "$") => v != null ? `${prefix}${Number(v).toLocaleString()}` : "—";
    lines.push(`| MVRV (price/realized) | ${onchainBtc.mvrv != null ? Number(onchainBtc.mvrv).toFixed(2) : "—"} |`);
    lines.push(`| Realized Price | ${f(onchainBtc.realized_price)} |`);
    lines.push(`| STH Realized Price | ${f(onchainBtc.sth_rp)} |`);
    lines.push(`| LTH Realized Price | ${f(onchainBtc.lth_rp)} |`);
    lines.push(`| CVDD | ${f(onchainBtc.cvdd)} |`);
    lines.push(`| Capturado em | ${onchainBtc.captured_at} |`);
    lines.push("");
  }

  lines.push("## Divergências");
  lines.push("");
  if (divergences.length === 0) {
    lines.push("Nenhuma. rules.json consistente com snapshot real.");
  } else {
    for (const d of divergences) lines.push(`- ⚠ ${d}`);
    lines.push("");
    lines.push("_Ação sugerida: atualizar `rules.json` manualmente. Edição livre (sem governança)._");
  }
  lines.push("");
  lines.push("---");
  lines.push(`_Gerado por \`scripts/regime-snapshot.js\`._`);
  lines.push("");
  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  // IMPORTANTE: cada símbolo precisa do SEU próprio adapter — createBinanceAdapter()
  // carrega estado interno (_symbol, _interval) em closure, então rodar em paralelo
  // com o mesmo adapter causa race condition (o último setSymbol ganha).
  const techPromises = SYMBOLS.map((s) =>
    analyzeTechnical(s, createBinanceAdapter()).catch((err) => ({ error: err.message, symbol: s }))
  );
  const [techs, macro] = await Promise.all([
    Promise.all(techPromises),
    analyzeMacro().catch((err) => ({ error: err.message })),
  ]);

  const regimes = {};
  for (let i = 0; i < SYMBOLS.length; i++) {
    const sym = SYMBOLS[i];
    const t = techs[i];
    if (t?.error) {
      regimes[sym] = null;
      continue;
    }
    const cls = classifyRegime(t);
    regimes[sym] = { tech: t, ...cls };
  }

  const rulesBias = loadRulesBias();
  const fearGreedNow = macro?.fearGreed?.value ?? null;
  const divergences = detectDivergences(regimes, fearGreedNow, rulesBias);

  // Carrega último snapshot on-chain por símbolo (observability)
  const onchain = {};
  for (const sym of SYMBOLS) {
    try { onchain[sym] = getLatestOnchainSnapshot(sym); }
    catch { onchain[sym] = null; }
  }

  const snapshot = { regimes, macro, rulesBias, divergences, onchain };

  if (JSON_OUT) {
    // remove bars grandes pra facilitar leitura
    const slim = JSON.parse(JSON.stringify(snapshot, (k, v) => (k === "bars" ? undefined : v)));
    console.log(JSON.stringify(slim, null, 2));
    return;
  }

  renderConsole(snapshot);

  if (SAVE) {
    mkdirSync(resolve(ROOT, "research/snapshots"), { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const path = resolve(ROOT, `research/snapshots/${stamp}.md`);
    const md = buildMarkdown(snapshot);
    writeFileSync(path, md);
    console.log(C.green(`✓ Snapshot gravado em ${path}`));
  }
}

main().catch((err) => {
  console.error(C.red(`\n✗ Erro: ${err.message}`));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
