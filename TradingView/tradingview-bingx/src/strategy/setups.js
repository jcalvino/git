// ─────────────────────────────────────────────────────────────────
//  Setup Evaluators
//
//  Cada função recebe (symbol, technical, onchain, macro, orderbook,
//  trendlines) e retorna um SetupResult. `evaluateSetups()` roda
//  todos, mantém só os triggered, e ordena por confidence desc.
//
//  Como adicionar setup novo:
//    1. Definir em src/config/strategy.js → SETUPS
//    2. Criar função _evalX(...) aqui retornando SetupResult
//    3. Registrar em _ALL_EVALUATORS abaixo
// ─────────────────────────────────────────────────────────────────

import { SETUPS } from "../config/strategy.js";

// ═══════════════════════════════════════════════════════════════════
//  TRENDLINE_RETEST — 3º toque ou break+retest na LTA/LTB diária
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {string} symbol
 * @param {object} technical
 * @param {object} onchain
 * @param {object} macro
 * @param {object} orderbook
 * @param {object} trendlines  — { lines:{lta,ltb}, atr, price, ... }
 * @returns {SetupResult}
 */
async function _evalTrendlineRetest(symbol, technical, onchain, macro, orderbook, trendlines) {
  const cfg = SETUPS.TRENDLINE_RETEST;
  if (!cfg?.enabled) return _notTriggered(cfg);
  if (cfg.symbols && !cfg.symbols.includes(symbol)) return _notTriggered(cfg);

  if (!trendlines) {
    return _notTriggered(cfg, ["Trendlines indisponíveis"]);
  }

  const P = cfg.params;

  // ── Varrer TFs em ordem de prioridade (D > H4) ───────────────────
  // O primeiro TF que tiver signal ativo vence. Base de confidence
  // específica de cada TF (D: 60/75, H4: 50/65).
  //
  // Mapeamento signal → { line, direction, signalType, lineRef }:
  //   3rd_touch_long   → LONG,  LTA (suporte rebatendo)
  //   3rd_touch_short  → SHORT, LTB (resistência rebatendo)
  //   break_retest_long  → LONG,  LTB (ex-resistência → suporte)
  //   break_retest_short → SHORT, LTA (ex-suporte → resistência)
  let line, direction, signalType, lineRef, tfFound, tfData;
  const skipReasons = [];

  for (const tf of (P.TIMEFRAMES ?? ["D"])) {
    const data = trendlines[tf];
    if (!data || data.error) {
      skipReasons.push(`${tf}: indisponível${data?.error ? ` (${data.error})` : ""}`);
      continue;
    }
    const lta = data.lines?.lta;
    const ltb = data.lines?.ltb;

    if (lta?.signal === "3rd_touch_long") {
      line = lta; direction = "LONG";  signalType = "3rd_touch";   lineRef = "LTA";
    } else if (ltb?.signal === "3rd_touch_short") {
      line = ltb; direction = "SHORT"; signalType = "3rd_touch";   lineRef = "LTB";
    } else if (ltb?.signal === "break_retest_long") {
      line = ltb; direction = "LONG";  signalType = "break_retest"; lineRef = "LTB";
    } else if (lta?.signal === "break_retest_short") {
      line = lta; direction = "SHORT"; signalType = "break_retest"; lineRef = "LTA";
    } else {
      const ltaState = lta?.state ?? "absent";
      const ltbState = ltb?.state ?? "absent";
      skipReasons.push(`${tf}: sem trigger (LTA ${ltaState}, LTB ${ltbState})`);
      continue;
    }

    tfFound = tf;
    tfData  = data;
    break;
  }

  if (!line) {
    return _notTriggered(cfg, [`Sem sinal de trendline — ${skipReasons.join(" | ")}`]);
  }

  // ── SL estrutural: linha ± SL_ATR_MULT × ATR ─────────────────────
  const entry   = Number(technical?.price ?? tfData.price);
  const atr     = Number(tfData.atr);
  const lineNow = Number(line.priceAtNow);

  if (!Number.isFinite(entry) || !Number.isFinite(atr) || !Number.isFinite(lineNow)) {
    return _notTriggered(cfg, ["Dados insuficientes (entry/atr/lineNow com NaN)"]);
  }

  const slPrice = direction === "LONG"
    ? lineNow - P.SL_ATR_MULT * atr
    : lineNow + P.SL_ATR_MULT * atr;

  const slPct = Math.abs(entry - slPrice) / entry;

  // Sanity: se o stop ficar do lado errado do preço, aborta (linha já foi atravessada).
  if (direction === "LONG" && slPrice >= entry) {
    return _notTriggered(cfg, [`SL estrutural ${slPrice.toFixed(2)} ≥ preço ${entry.toFixed(2)} — linha atravessada`]);
  }
  if (direction === "SHORT" && slPrice <= entry) {
    return _notTriggered(cfg, [`SL estrutural ${slPrice.toFixed(2)} ≤ preço ${entry.toFixed(2)} — linha atravessada`]);
  }

  // ── Confidence base (dependente do TF vencedor) + modificadores ──
  const tfLabel = tfFound === "240" ? "H4" : tfFound;
  const baseForTf = P.BASE?.[tfFound]?.[signalType]
    ?? (signalType === "break_retest" ? 75 : 60); // fallback defensivo
  let confidence = baseForTf;
  const rationale = [
    `${signalType === "3rd_touch" ? "3º toque" : "rompimento + retest"} na ${lineRef} ${tfLabel} (${line.touches ?? "?"} toques, base ${baseForTf})`,
    `Entry ${entry.toFixed(2)} · SL estrutural ${slPrice.toFixed(2)} (${(slPct * 100).toFixed(2)}%)`,
  ];

  // EMA200 diária
  const aboveEma200 = technical?.daily?.priceAboveEma200;
  if (aboveEma200 !== null && aboveEma200 !== undefined) {
    const aligned = (direction === "LONG") === aboveEma200;
    const delta = aligned ? P.MOD_EMA200_DAILY : -P.MOD_EMA200_DAILY;
    confidence += delta;
    rationale.push(`EMA200 diária ${aligned ? "a favor" : "contra"} (${delta >= 0 ? "+" : ""}${delta})`);
  }

  // MACD semanal (weeklyFixed > weekly como fallback)
  const weeklyMacd = technical?.weeklyFixed?.macd ?? technical?.weekly?.macd;
  const hist = weeklyMacd?.histogram ?? weeklyMacd?.hist;
  if (Number.isFinite(hist)) {
    const macdBull = hist > 0;
    const aligned = (direction === "LONG") === macdBull;
    const delta = aligned ? P.MOD_MACD_WEEKLY : -P.MOD_MACD_WEEKLY;
    confidence += delta;
    rationale.push(`MACD semanal ${aligned ? "a favor" : "contra"} (${delta >= 0 ? "+" : ""}${delta})`);
  }

  // Orderbook imbalance
  const obSignal = orderbook?.signal;
  if (obSignal === "bullish" || obSignal === "bearish") {
    const obBull = obSignal === "bullish";
    const aligned = (direction === "LONG") === obBull;
    const delta = aligned ? P.MOD_ORDERBOOK : -P.MOD_ORDERBOOK;
    confidence += delta;
    rationale.push(`Orderbook ${obSignal} ${aligned ? "a favor" : "contra"} (${delta >= 0 ? "+" : ""}${delta})`);
  }

  // Funding rate (signal vem do onchain: bullish = shorts pagando longs)
  const fundingSignal = onchain?.funding?.signal;
  if (fundingSignal === "bullish" || fundingSignal === "bearish") {
    const fundBull = fundingSignal === "bullish";
    const aligned = (direction === "LONG") === fundBull;
    const delta = aligned ? P.MOD_FUNDING : -P.MOD_FUNDING;
    confidence += delta;
    rationale.push(`Funding ${fundingSignal} (${onchain.funding.ratePct ?? "?"}%) ${aligned ? "a favor" : "contra"} (${delta >= 0 ? "+" : ""}${delta})`);
  }

  // Fear & Greed (extremos = contrarian)
  const fg = Number(macro?.fearGreed?.value);
  if (Number.isFinite(fg)) {
    let delta = 0;
    if (fg <= 25 && direction === "LONG")  delta =  P.MOD_FEAR_GREED;
    if (fg <= 25 && direction === "SHORT") delta = -P.MOD_FEAR_GREED;
    if (fg >= 75 && direction === "SHORT") delta =  P.MOD_FEAR_GREED;
    if (fg >= 75 && direction === "LONG")  delta = -P.MOD_FEAR_GREED;
    if (delta !== 0) {
      confidence += delta;
      rationale.push(`Fear&Greed ${fg} ${delta > 0 ? "contrarian a favor" : "extremo contra"} (${delta > 0 ? "+" : ""}${delta})`);
    }
  }

  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  return {
    setup_id:   cfg.id,
    setup_name: cfg.name,
    triggered:  true,
    direction,
    confidence,
    rationale,
    leverage:   cfg.leverage,
    sl_pct:     slPct,          // ← sobrescreve o fallback estático da config
    tp_r:       cfg.tp_r,
    meta: {
      timeframe:    tfFound,       // "D" | "240"
      timeframeLabel: tfLabel,     // "D" | "H4"
      signalType,
      lineRef,
      lineNow,
      atr,
      structuralSl: slPrice,
      touches:      line.touches,
      baseConfidence: baseForTf,
    },
  };
}

// ── Lista de avaliadores ativos ──────────────────────────────────
const _ALL_EVALUATORS = [
  _evalTrendlineRetest,
];

/**
 * Avalia todos os setups aplicáveis a um símbolo.
 *
 * @param {string} symbol       — e.g. "BTCUSDC"
 * @param {object} technical    — resultado de analyzeTechnical()
 * @param {object} onchain      — resultado de analyzeOnChain()
 * @param {object} [macro]      — resultado de analyzeMacro()
 * @param {object} [orderbook]  — resultado de analyzeOrderBook()
 * @param {object} [trendlines] — resultado de analyzeTrendlines() na diária
 * @returns {Promise<SetupResult[]>} — só triggered, ordenados por confidence desc
 */
export async function evaluateSetups(
  symbol,
  technical,
  onchain,
  macro = null,
  orderbook = null,
  trendlines = null,
) {
  if (!_ALL_EVALUATORS.length || !Object.keys(SETUPS).length) return [];

  const results = await Promise.allSettled(
    _ALL_EVALUATORS.map((fn) =>
      fn(symbol, technical, onchain, macro, orderbook, trendlines)
    )
  );

  return results
    .filter((r) => r.status === "fulfilled" && r.value?.triggered)
    .map((r) => r.value)
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Como evaluateSetups, mas retorna TODOS os resultados (triggered + skipped).
 * Útil para observabilidade — quando nada dispara, permite ao scanner/logs
 * mostrar o motivo do skip de cada setup.
 *
 * @returns {Promise<SetupResult[]>} — todos os resultados, com triggered:bool
 */
export async function evaluateSetupsDetailed(
  symbol,
  technical,
  onchain,
  macro = null,
  orderbook = null,
  trendlines = null,
) {
  if (!_ALL_EVALUATORS.length || !Object.keys(SETUPS).length) return [];

  const results = await Promise.allSettled(
    _ALL_EVALUATORS.map((fn) =>
      fn(symbol, technical, onchain, macro, orderbook, trendlines)
    )
  );

  return results
    .map((r) => {
      if (r.status === "fulfilled") return r.value;
      // evaluator jogou exception — devolver um skip sintético com a mensagem
      return {
        setup_id:   "UNKNOWN",
        setup_name: "Unknown",
        triggered:  false,
        direction:  null,
        confidence: 0,
        rationale:  [`Erro no evaluator: ${r.reason?.message ?? r.reason}`],
      };
    });
}

// ── Helpers ──────────────────────────────────────────────────────

export function _notTriggered(cfg, rationale = []) {
  return {
    setup_id:   cfg?.id ?? "UNKNOWN",
    setup_name: cfg?.name ?? "Unknown",
    triggered:  false,
    direction:  null,
    confidence: 0,
    rationale,
    leverage:   cfg?.leverage ?? 1,
    sl_pct:     cfg?.sl_pct ?? 0.005,
    tp_r:       cfg?.tp_r ?? { tp1: 1.5, tp2: 2.618, tp3: 4.236 },
  };
}

export default { evaluateSetups };
