// ─────────────────────────────────────────────────────────────────
//  scripts/validate-trendlines.js
//
//  Valida o módulo trendlines contra dados reais de BTC e ETH
//  batendo no endpoint /api/trendlines/:symbol da API local.
//
//  Uso (com a API rodando em localhost:3001):
//    node scripts/validate-trendlines.js
//    node scripts/validate-trendlines.js --tf 240,D
//    node scripts/validate-trendlines.js --tf 60 --fresh
//
//  Flags:
//    --tf <list>   timeframes separados por vírgula (padrão: 240,D)
//    --fresh       força fresh (ignora cache do endpoint)
//    --json        imprime JSON bruto por linha (sem resumo)
// ─────────────────────────────────────────────────────────────────

const API_BASE = process.env.API_BASE ?? "http://localhost:3001";
const SYMBOLS  = ["BTCUSDC", "ETHUSDC"];

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
}

const TFS     = (flag("--tf") && flag("--tf") !== true ? flag("--tf") : "240,D").split(",");
const FRESH   = !!flag("--fresh");
const AS_JSON = !!flag("--json");

const TF_LABEL = { "15": "M15", "30": "M30", "60": "H1", "240": "H4", "D": "D", "W": "W" };

// ── Helpers ──────────────────────────────────────────────────────
function fmt(n, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pct(n, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function stateEmoji(s) {
  switch (s) {
    case "valid":       return "✓ valid";
    case "approaching": return "→ approaching";
    case "touching":    return "✦ TOUCHING";
    case "broken":      return "✗ broken";
    case "retesting":   return "↻ retesting";
    default:            return s ?? "—";
  }
}

// ── Sanity flags ─────────────────────────────────────────────────
//
// Severidade:
//   "error" (✗) — dados quebrados, linha definicionalmente inválida.
//                 Se isso aparece, a trendline detectada NÃO pode ser
//                 usada pra trade.
//   "warn"  (⚠) — linha tecnicamente válida mas com propriedade rara
//                 que merece atenção (ex: linha 5×ATR fora do preço).
//                 Ainda pode entrar no setup, mas com ceticismo.
//   "info"  (ℹ) — apenas estado do mercado, não é bug. Ex: "LTA não
//                 detectada" acontece toda hora em períodos laterais.
//
// Nota sobre thresholds de distância:
//   Antes o validador flagava qualquer linha > 2×ATR como "improvável".
//   Mas um setup de break_retest pode ficar 5-10% afastado enquanto a
//   gente espera retest — isso é normal, não é anomalia. Subimos pra
//   5×ATR como limite de "ainda plausível" e 10×ATR como "implausível".
function sanityCheck(data) {
  const flags = [];
  const add = (severity, msg) => flags.push({ severity, msg });

  if (!data)      return [{ severity: "error", msg: "no response" }];
  if (data.error) return [{ severity: "error", msg: `API error: ${data.error}` }];

  // ── Dados de entrada ──
  if (!data.bars || data.bars.length < 50) {
    add("error", `only ${data.bars?.length ?? 0} bars (< 50 minimum)`);
  }
  if (!data.pivots?.highs?.length || !data.pivots?.lows?.length) {
    add("error", `missing pivots (highs=${data.pivots?.highs?.length ?? 0}, lows=${data.pivots?.lows?.length ?? 0})`);
  }

  const lta = data.lines?.lta;
  const ltb = data.lines?.ltb;
  const atr = data.atr ?? 0;

  // ── LTA (suporte ascendente) ──
  if (lta) {
    // Slope ≤ 0 = não é ascendente → definicionalmente inválido.
    if (lta.slope <= 0) {
      add("error", `LTA slope não positivo (${lta.slope.toExponential(2)}) — não é ascendente`);
    }
    // LTA deveria estar abaixo ou perto do preço (suporte).
    // -10×ATR acima = implausível; -5×ATR a -10×ATR = atenção; <-5×ATR = ok.
    const distAboveAtr = -lta.distance / atr;  // positivo se linha acima do preço
    if (distAboveAtr > 10) {
      add("warn", `LTA ${fmt(Math.abs(lta.distance))} ACIMA do preço (${distAboveAtr.toFixed(1)}×ATR) — suporte implausível`);
    } else if (distAboveAtr > 5) {
      add("info", `LTA ${fmt(Math.abs(lta.distance))} acima do preço (${distAboveAtr.toFixed(1)}×ATR) — afastada, setup em espera de retest`);
    }
  } else {
    add("info", "LTA não detectada (mercado lateral ou sem pivots de baixa significativos)");
  }

  // ── LTB (resistência descendente) ──
  if (ltb) {
    if (ltb.slope >= 0) {
      add("error", `LTB slope não negativo (${ltb.slope.toExponential(2)}) — não é descendente`);
    }
    const distBelowAtr = ltb.distance / atr;
    if (distBelowAtr > 10) {
      add("warn", `LTB ${fmt(ltb.distance)} ABAIXO do preço (${distBelowAtr.toFixed(1)}×ATR) — resistência implausível`);
    } else if (distBelowAtr > 5) {
      add("info", `LTB ${fmt(ltb.distance)} abaixo do preço (${distBelowAtr.toFixed(1)}×ATR) — afastada, setup em espera de retest`);
    }
  } else {
    add("info", "LTB não detectada (mercado lateral ou sem pivots de alta significativos)");
  }

  return flags;
}

// Ícone por severidade pra manter o print consistente com o resto.
const SEVERITY_ICON = { error: "✗", warn: "⚠", info: "ℹ" };

// ── Pretty-print one symbol+timeframe result ─────────────────────
function printSummary(symbol, tf, data) {
  const tfLabel = TF_LABEL[tf] ?? tf;
  const header  = `── ${symbol}  [${tfLabel}] ─────────────────────────────────`;
  console.log("");
  console.log(header);

  if (data.error) {
    console.log(`  ✗ ERROR: ${data.error}`);
    return;
  }

  console.log(`  Preço atual    : ${fmt(data.price)}`);
  console.log(`  ATR(14)        : ${fmt(data.atr)}   (tolerância toque: ${fmt(data.atr * 0.3)})`);
  console.log(`  Barras         : ${data.barCount}`);
  console.log(`  Pivots         : ${data.pivots.highs.length} highs · ${data.pivots.lows.length} lows  (N=${data.config.N})`);

  // Últimos 3 pivots de cada lado (mais relevantes pras linhas)
  const recentHighs = data.pivots.highs.slice(-3);
  const recentLows  = data.pivots.lows.slice(-3);
  if (recentHighs.length) {
    console.log(`    ↑ últimos highs: ${recentHighs.map(p => fmt(p.price)).join(" → ")}`);
  }
  if (recentLows.length) {
    console.log(`    ↓ últimos lows : ${recentLows.map(p => fmt(p.price)).join(" → ")}`);
  }

  // LTA (suporte ascendente)
  const lta = data.lines?.lta;
  if (lta) {
    console.log(`  LTA (suporte)  : ${stateEmoji(lta.state)}`);
    console.log(`    p1 = ${fmt(lta.p1.price)}   p2 = ${fmt(lta.p2.price)}   @now = ${fmt(lta.priceAtNow)}`);
    console.log(`    distância      : ${fmt(lta.distance)}  (${pct(lta.distancePct)})`);
    console.log(`    toques         : ${lta.touches}${lta.signal ? `   ⚡ SINAL: ${lta.signal}` : ""}`);
    if (lta.break) {
      console.log(`    break detected : ${lta.break.retested ? "retestado" : "sem retest"}`);
    }
  } else {
    console.log(`  LTA (suporte)  : — (não detectada)`);
  }

  // LTB (resistência descendente)
  const ltb = data.lines?.ltb;
  if (ltb) {
    console.log(`  LTB (resist.)  : ${stateEmoji(ltb.state)}`);
    console.log(`    p1 = ${fmt(ltb.p1.price)}   p2 = ${fmt(ltb.p2.price)}   @now = ${fmt(ltb.priceAtNow)}`);
    console.log(`    distância      : ${fmt(ltb.distance)}  (${pct(ltb.distancePct)})`);
    console.log(`    toques         : ${ltb.touches}${ltb.signal ? `   ⚡ SINAL: ${ltb.signal}` : ""}`);
    if (ltb.break) {
      console.log(`    break detected : ${ltb.break.retested ? "retestado" : "sem retest"}`);
    }
  } else {
    console.log(`  LTB (resist.)  : — (não detectada)`);
  }

  // Sanity flags — agora com severidade (error/warn/info).
  // Só trata "error" + "warn" como problema; "info" é contexto normal.
  const flags  = sanityCheck(data);
  const errors = flags.filter((f) => f.severity === "error");
  const warns  = flags.filter((f) => f.severity === "warn");
  const infos  = flags.filter((f) => f.severity === "info");

  if (errors.length) {
    console.log(`  ✗ sanity       : ${errors.length} erro(s) — linha INVÁLIDA pra trade`);
    errors.forEach((f) => console.log(`    · ${f.msg}`));
    if (warns.length) warns.forEach((f) => console.log(`    ⚠ ${f.msg}`));
    if (infos.length) infos.forEach((f) => console.log(`    ℹ ${f.msg}`));
  } else if (warns.length) {
    console.log(`  ⚠ sanity       : ${warns.length} aviso(s) — linha válida, mas olhar com ceticismo`);
    warns.forEach((f) => console.log(`    · ${f.msg}`));
    if (infos.length) infos.forEach((f) => console.log(`    ℹ ${f.msg}`));
  } else if (infos.length) {
    console.log(`  ✓ sanity       : ok`);
    infos.forEach((f) => console.log(`    ℹ ${f.msg}`));
  } else {
    console.log(`  ✓ sanity       : ok`);
  }
}

// ── Fetch + orchestrate ──────────────────────────────────────────
async function fetchTrendlines(symbol, tf) {
  const qs  = FRESH ? "&fresh=1" : "";
  const url = `${API_BASE}/api/trendlines/${symbol}?timeframe=${tf}${qs}`;
  const res = await fetch(url);
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { error: `HTTP ${res.status} — ${txt.slice(0, 200)}` };
  }
}

async function main() {
  console.log(`Validando trendlines via ${API_BASE}`);
  console.log(`Timeframes: ${TFS.join(", ")}    Symbols: ${SYMBOLS.join(", ")}${FRESH ? "    (fresh)" : ""}`);

  const results = [];
  for (const symbol of SYMBOLS) {
    for (const tf of TFS) {
      const data = await fetchTrendlines(symbol, tf);
      results.push({ symbol, tf, data });
      if (AS_JSON) {
        console.log(JSON.stringify({ symbol, tf, data }));
      } else {
        printSummary(symbol, tf, data);
      }
    }
  }

  if (!AS_JSON) {
    console.log("");
    console.log("═════════════════════════════════════════════");
    console.log(" RESUMO DE SINAIS ATIVOS");
    console.log("═════════════════════════════════════════════");
    let anySignal = false;
    for (const { symbol, tf, data } of results) {
      const lta = data?.lines?.lta;
      const ltb = data?.lines?.ltb;
      if (lta?.signal) {
        anySignal = true;
        console.log(` ${symbol} [${TF_LABEL[tf] ?? tf}]  LTA → ${lta.signal}  (${lta.touches} toques @ ${fmt(lta.priceAtNow)})`);
      }
      if (ltb?.signal) {
        anySignal = true;
        console.log(` ${symbol} [${TF_LABEL[tf] ?? tf}]  LTB → ${ltb.signal}  (${ltb.touches} toques @ ${fmt(ltb.priceAtNow)})`);
      }
    }
    if (!anySignal) console.log(" (nenhum sinal disparado agora — estado normal durante range)");
    console.log("");
  }
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
