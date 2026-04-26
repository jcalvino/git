// ─────────────────────────────────────────────────────────────────
//  healthcheck.js — Valida estado RUNTIME antes de ligar o bot
//
//  Checa:
//    1. .env existe e campos críticos preenchidos
//    2. PAPER_TRADE=true (guarda contra live mode acidental)
//    3. data/trades.db existe e tem schema correto
//    4. rules.json parseável, bloco datado mais recente coerente
//    5. Binance Spot REST responde (OHLCV público — fonte dos indicadores)
//    6. BingX REST responde (price/orderbook)
//    7. CoinGlass responde (fear & greed — fallback ok se não responder)
//    8. Scheduled task `tradingview-bingx-weekly-report` registrado (informativo)
//
//  Usage:
//    node scripts/healthcheck.js
//    node scripts/healthcheck.js --quiet     (só imprime se houver falha)
//
//  Exit codes:
//    0 = tudo ok pra operar
//    1 = erro crítico — NÃO ligar o bot antes de resolver
//    2 = só warnings (opcional corrigir, mas pode operar)
// ─────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const QUIET = process.argv.includes("--quiet");

// ── Colors ──────────────────────────────────────────────────────
const C = {
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  grey:   (s) => `\x1b[90m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
};

const problems = []; // { severity, section, msg }
const buffer = [];
function out(line = "") { QUIET ? buffer.push(line) : console.log(line); }
function section(name) { out(); out(C.bold(`=== ${name} ===`)); }
function ok(msg)       { out(`  ${C.green("✓")} ${msg}`); }
function bad(sec, msg) { problems.push({ severity: "error", sec, msg }); out(`  ${C.red("✗")} ${msg}`); }
function warn(sec, msg){ problems.push({ severity: "warn",  sec, msg }); out(`  ${C.yellow("⚠")} ${msg}`); }
function info(msg)     { out(`  ${C.grey("·")} ${C.grey(msg)}`); }

// ── 1. .env ─────────────────────────────────────────────────────
function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

let env = {};
function checkEnv() {
  section("1. .env / variáveis de ambiente");
  const path = resolve(ROOT, ".env");

  // Em container Docker o .env não é montado como arquivo — vem via env_file:
  // como variáveis de ambiente. Detectar isso e validar process.env diretamente.
  if (existsSync(path)) {
    ok(".env existe (host)");
    env = parseEnv(readFileSync(path, "utf8"));
  } else if (process.env.PAPER_TRADE !== undefined) {
    ok("variáveis de ambiente carregadas (provavelmente via Docker env_file)");
    env = process.env;
  } else {
    bad("env", "nem .env existe nem PAPER_TRADE está em process.env — env não foi carregado");
    return;
  }

  // PAPER_TRADE
  if (env.PAPER_TRADE === "true") {
    ok(`PAPER_TRADE=true (modo simulação — seguro)`);
  } else if (env.PAPER_TRADE === "false") {
    warn("env", `PAPER_TRADE=false — LIVE TRADING habilitado. Confirme se é intencional.`);
  } else {
    bad("env", `PAPER_TRADE não configurado ou valor inesperado: "${env.PAPER_TRADE}"`);
  }

  // Capital — aceita CAPITAL_USDC (preferido) ou CAPITAL_USDT (legacy)
  // Mesma lógica de src/config/index.js
  const capRaw = env.CAPITAL_USDC ?? env.CAPITAL_USDT ?? "0";
  const cap = parseFloat(capRaw);
  const capVar = env.CAPITAL_USDC ? "CAPITAL_USDC" : "CAPITAL_USDT";
  if (cap > 0) ok(`${capVar}=${cap} (fallback estático; refreshCapital lê BingX em runtime)`);
  else bad("env", `nem CAPITAL_USDC nem CAPITAL_USDT estão configurados`);

  // MIN_SCORE
  const ms = parseInt(env.MIN_SCORE ?? "0");
  if (ms >= 40 && ms <= 95) ok(`MIN_SCORE=${ms}`);
  else warn("env", `MIN_SCORE=${ms} — fora do range usual 40-95`);

  // BingX keys (só aviso se PAPER_TRADE=true e vazias; erro se false)
  const hasTradeKeys = env.BINGX_API_KEY && env.BINGX_API_KEY !== "your_trade_api_key_here" && env.BINGX_SECRET_KEY;
  if (env.PAPER_TRADE === "false" && !hasTradeKeys) {
    bad("env", "PAPER_TRADE=false mas BINGX_API_KEY/SECRET não estão configurados");
  } else if (!hasTradeKeys) {
    info("BINGX_API_KEY não configurada (ok em paper mode — placeholder)");
  } else {
    ok("BINGX_API_KEY configurada");
  }
}

// ── 2. DB ───────────────────────────────────────────────────────
function checkDb() {
  section("2. Banco de dados SQLite");
  const dbPath = resolve(ROOT, env.DB_PATH?.replace(/^\.\//, "") ?? "data/trades.db");
  if (!existsSync(dbPath)) {
    bad("db", `${dbPath} não existe — rode node src/storage/init.js ou qualquer script que instancie DB`);
    return;
  }
  ok(`DB existe (${dbPath})`);

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    bad("db", `falha ao abrir DB: ${err.message}`);
    return;
  }

  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const required = ["signals", "trades", "positions", "snapshots"];
    const missing = required.filter((t) => !tables.includes(t));
    if (missing.length === 0) ok(`tabelas ok: ${required.join(", ")}`);
    else bad("db", `tabelas faltando: ${missing.join(", ")}`);

    // Colunas críticas em signals
    if (tables.includes("signals")) {
      const cols = db.prepare("PRAGMA table_info(signals)").all().map((c) => c.name);
      const neededCols = ["id", "symbol", "direction", "score", "status", "setup_id", "superseded_by"];
      const missCols = neededCols.filter((c) => !cols.includes(c));
      if (missCols.length === 0) ok("signals schema ok (setup_id, superseded_by presentes)");
      else bad("db", `signals faltando colunas: ${missCols.join(", ")} — rode scripts/migrate-signals-schema.js`);

      // Contagem rápida
      const total = db.prepare("SELECT COUNT(*) as n FROM signals").get().n;
      const last24h = db.prepare("SELECT COUNT(*) as n FROM signals WHERE datetime(created_at) >= datetime('now','-1 day')").get().n;
      info(`signals: ${total} total · ${last24h} nas últimas 24h`);
    }

    // Trades
    if (tables.includes("trades")) {
      const open = db.prepare("SELECT COUNT(*) as n FROM trades WHERE status = 'OPEN'").get().n;
      const closed = db.prepare("SELECT COUNT(*) as n FROM trades WHERE status != 'OPEN'").get().n;
      info(`trades: ${open} abertos · ${closed} fechados`);
    }
  } catch (err) {
    bad("db", `query falhou: ${err.message}`);
  } finally {
    db.close();
  }
}

// ── 3. rules.json ───────────────────────────────────────────────
function checkRules() {
  section("3. rules.json");
  const path = resolve(ROOT, "rules.json");
  if (!existsSync(path)) {
    bad("rules", "rules.json não existe");
    return;
  }
  let j;
  try { j = JSON.parse(readFileSync(path, "utf8")); }
  catch (err) { bad("rules", `JSON inválido: ${err.message}`); return; }
  ok("rules.json parseável");

  const datedKey = Object.keys(j).filter((k) => k.startsWith("market_context_")).sort().pop();
  if (!datedKey) {
    warn("rules", "nenhum bloco market_context_YYYY_MM_DD — motor vai usar o raiz (menos informado)");
    return;
  }
  const ctx = j[datedKey];
  ok(`bloco datado mais recente: ${datedKey}`);

  if (ctx.overall_bias) ok(`overall_bias: ${ctx.overall_bias}`);
  else warn("rules", "overall_bias vazio — scoring macro vai ficar neutro");

  if (ctx.last_updated) {
    const daysOld = (Date.now() - new Date(ctx.last_updated).getTime()) / 86400_000;
    if (daysOld > 7) warn("rules", `last_updated = ${ctx.last_updated} (${daysOld.toFixed(0)}d atrás) — considere atualizar`);
    else ok(`last_updated: ${ctx.last_updated} (${daysOld.toFixed(1)}d atrás)`);
  } else {
    warn("rules", "last_updated vazio");
  }

  if (Array.isArray(ctx.analyst_inputs) && ctx.analyst_inputs.length > 0) {
    ok(`analyst_inputs: ${ctx.analyst_inputs.length} entrada(s)`);
    for (const a of ctx.analyst_inputs) info(`  - ${a.source} (${a.specialty}, ${a.date})`);
  } else {
    info("analyst_inputs vazio (ok — opcional)");
  }
}

// ── 4. APIs externas ────────────────────────────────────────────
async function pingUrl(url, label, { timeoutMs = 5000, expectKey, critical = true } = {}) {
  const fail = critical ? bad : warn;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) { fail("api", `${label}: HTTP ${res.status}${critical ? "" : " (não crítico — tem fallback)"}`); return null; }
    const body = await res.json();
    if (expectKey && !(expectKey in body) && !Array.isArray(body)) {
      warn("api", `${label}: respondeu mas não tem campo "${expectKey}" esperado`);
    } else {
      ok(`${label} ok`);
    }
    return body;
  } catch (err) {
    fail("api", `${label}: ${err.name === "AbortError" ? "timeout" : err.message}${critical ? "" : " (não crítico — tem fallback)"}`);
    return null;
  }
}

async function checkApis() {
  section("4. APIs externas");
  // Binance spot (fonte de OHLCV)
  await pingUrl(
    "https://api.binance.com/api/v3/klines?symbol=BTCUSDC&interval=1h&limit=1",
    "Binance Spot /klines BTCUSDC 1h"
  );
  // BingX (fonte de preço/orderbook)
  await pingUrl(
    "https://open-api.bingx.com/openApi/swap/v2/quote/price?symbol=BTC-USDC",
    "BingX /quote/price BTC-USDC",
    { expectKey: "data" }
  );
  // Fear & Greed — testar em ordem de preferência (mesma chain do macro.js)
  //   1. alternative.me (primária — fonte canônica)
  //   2. CoinGlass (backup)
  // Só fica crítico se AMBAS caírem (aí mesmo assim tem fallback rules.json,
  // mas é sinal de problema de rede).
  let fgOk = false;

  const altMe = await pingUrl(
    "https://api.alternative.me/fng/?limit=1",
    "Fear & Greed — alternative.me (primária)",
    { critical: false }
  );
  if (altMe) {
    fgOk = true;
    const latest = altMe.data?.[0];
    if (latest?.value) info(`Fear & Greed atual: ${latest.value} (${latest.value_classification ?? "?"})`);
  }

  const cg = await pingUrl(
    "https://open-api.coinglass.com/public/v2/index/fear_greed_history?limit=1",
    "Fear & Greed — CoinGlass (backup)",
    { critical: false }
  );
  if (cg) fgOk = true;

  if (!fgOk) {
    warn("api", "Ambas as fontes de Fear & Greed caíram — macro.js vai usar fallback do rules.json");
  }
}

// ── 5. Scheduled task (informativo) ─────────────────────────────
function checkScheduled() {
  section("5. Scheduled task weekly-report");
  info("Verifique no Cowork/Claude: scheduled task 'tradingview-bingx-weekly-report' ativa (domingo 20:00)");
  info("Comando manual alternativo: node scripts/weekly-report.js");
}

// ── Run ─────────────────────────────────────────────────────────
(async () => {
  console.log(C.bold("\n═══ tradingview-bingx — Healthcheck Runtime ═══"));
  console.log(C.grey(`  ${new Date().toISOString()}`));

  checkEnv();
  checkDb();
  checkRules();
  await checkApis();
  checkScheduled();

  const errors = problems.filter((p) => p.severity === "error");
  const warns  = problems.filter((p) => p.severity === "warn");

  if (QUIET && errors.length === 0 && warns.length === 0) process.exit(0);
  if (QUIET) { for (const line of buffer) console.log(line); }

  console.log();
  if (errors.length === 0 && warns.length === 0) {
    console.log(C.green(C.bold("✓ Tudo pronto pra operar em paper mode.")));
    console.log(C.cyan("  Próximo passo: node scripts/start.js"));
    process.exit(0);
  } else if (errors.length === 0) {
    console.log(C.yellow(C.bold(`⚠ ${warns.length} aviso(s) — pode operar, mas revise.`)));
    process.exit(2);
  } else {
    console.log(C.red(C.bold(`✗ ${errors.length} erro(s) crítico(s).`)));
    if (warns.length > 0) console.log(C.yellow(`  (+ ${warns.length} aviso(s))`));
    console.log(C.red("  NÃO ligue o bot antes de resolver."));
    process.exit(1);
  }
})().catch((err) => {
  console.error(C.red(`\n✗ Healthcheck falhou: ${err.message}`));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
