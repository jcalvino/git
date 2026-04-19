// ─────────────────────────────────────────────────────────────────
//  Setup Evaluators
//  Each of the 5 named setups has its own trigger logic designed
//  specifically for 15min day trading with 1H trend context.
//
//  Setup architecture:
//   Setup 1 — EMA Pullback Continuation (15min + 1H)
//             Trend direction from 1H EMA9/21/50 stack.
//             Entry when 15min price pulls back to EMA21 + reversal candle.
//
//   Setup 2 — STH Realized Price SHORT (BTC isolated rule)
//             Fires SHORT when BTC price converges toward STH Realized Price.
//
//   Setup 3 — S/R Breakout + Retest (1H levels + 15min entry)
//             Key horizontal S/R from 1H swing points. Enter at the
//             "level flip" retest — highest institutional volume zone.
//
//   Setup 4 — Open Interest Confirmation Filter
//             OI increasing = trend strengthening (boosts or confirms).
//             OI decreasing = trend weakening (penalizes other setups).
//
//   Setup 5 — Liquidation Zone Accumulation (BTC only)
//             Large liquidation cluster on one side → cascade hunt.
//
//  Weekly RSI / StochRSI / MACD are used ONLY as a direction bias
//  filter (_computeWeeklyBias). They gate which direction is allowed —
//  they do NOT trigger entries on their own.
//
//  SetupResult shape:
//  {
//    setup_id:    string,
//    setup_name:  string,
//    triggered:   boolean,
//    direction:   "LONG"|"SHORT"|null,
//    confidence:  number,        // 0–100
//    rationale:   string[],
//    leverage:    number,
//    sl_pct:      number,
//    tp_r:        object,        // { tp1, tp2, tp3 } R multiples
//  }
// ─────────────────────────────────────────────────────────────────

import { SETUPS } from "../config/strategy.js";
import { getSTHRealizedPrice } from "../analysis/sth_price.js";
import { analyzeLiquidations } from "../analysis/liquidations.js";

// ── Main Entry Point ───────────────────────────────────────────

/**
 * Evaluate all applicable setups for a symbol.
 *
 * @param {string}  symbol    — "BTCUSDT" | "ETHUSDT"
 * @param {object}  technical — from analyzeTechnical()
 * @param {object}  onchain   — from analyzeOnChain()
 * @returns {Promise<SetupResult[]>} — only triggered setups, sorted by confidence desc
 */
export async function evaluateSetups(symbol, technical, onchain) {
  const results = await Promise.allSettled([
    _evalEmaPullback(symbol, technical),
    _evalSTHRealizedPrice(symbol, technical),
    _evalSrBreakoutRetest(symbol, technical),
    _evalOIConfirmation(symbol, onchain, technical),
    _evalLiquidationZone(symbol, technical),
  ]);

  const triggered = results
    .filter((r) => r.status === "fulfilled" && r.value?.triggered)
    .map((r) => r.value);

  // Apply OI filter: boost or reduce confidence of other setups
  const oiResult = results.find(
    (r) => r.status === "fulfilled" && r.value?.setup_id === "OI_CONFIRMATION"
  )?.value;

  if (oiResult) {
    return triggered
      .filter((s) => s.setup_id !== "OI_CONFIRMATION" || !SETUPS.OI_CONFIRMATION.filterOnly)
      .map((s) => _applyOiFilter(s, oiResult))
      .sort((a, b) => b.confidence - a.confidence);
  }

  return triggered.sort((a, b) => b.confidence - a.confidence);
}

// ── Setup 1: EMA Pullback Continuation ────────────────────────
// 1H EMA9/21/50 stack defines the trend.
// 15min pullback to EMA21 + reversal candle = entry in trend direction.
// Weekly RSI/MACD/StochRSI used only as a bias bonus/penalty.

async function _evalEmaPullback(symbol, technical) {
  const cfg = SETUPS.EMA_PULLBACK;
  if (!cfg.enabled || (cfg.symbols && !cfg.symbols.includes(symbol))) {
    return _notTriggered(cfg);
  }

  const price    = technical.price;
  const weekly   = technical.weekly;   // 1H timeframe
  const entry15  = technical.entry;    // 15min indicators
  const bars15   = technical.daily?.bars ?? [];
  const rationale = [];

  // ── Step 1: 1H EMA stack determines trend ─────────────────────
  const ema9_1h  = weekly.ema9;
  const ema21_1h = weekly.ema21;
  const ema50_1h = weekly.ema50;

  if (!ema9_1h || !ema21_1h || !ema50_1h) {
    return _notTriggered(cfg, [
      "EMA9/21/50 no 1H indisponível — aguardando barras suficientes",
    ]);
  }

  const bullishStack = ema9_1h > ema21_1h && ema21_1h > ema50_1h;
  const bearishStack = ema9_1h < ema21_1h && ema21_1h < ema50_1h;

  if (!bullishStack && !bearishStack) {
    return _notTriggered(cfg, [
      `EMA Stack 1H sem tendência clara:`,
      `  EMA9(${ema9_1h.toFixed(0)}) / EMA21(${ema21_1h.toFixed(0)}) / EMA50(${ema50_1h.toFixed(0)})`,
      `Mercado em consolidação — aguardar alinhamento do stack para operar`,
    ]);
  }

  const direction = bullishStack ? "LONG" : "SHORT";
  const isLong    = direction === "LONG";
  let confidence  = 0;

  rationale.push(
    `EMA Stack ${direction} confirmado no 1H: ` +
    `EMA9(${ema9_1h.toFixed(0)}) ${isLong ? ">" : "<"} ` +
    `EMA21(${ema21_1h.toFixed(0)}) ${isLong ? ">" : "<"} ` +
    `EMA50(${ema50_1h.toFixed(0)}) ✓`
  );
  confidence += 40;

  // ── Step 2: 15min price touching EMA21 ────────────────────────
  // LONG: price pulling back TO the EMA21 from above (touching from bullish side)
  // SHORT: price bouncing up TO the EMA21 from below
  const ema21_15 = entry15?.ema21;
  if (!ema21_15) {
    return _notTriggered(cfg, [
      ...rationale,
      "EMA21 no 15min indisponível",
    ]);
  }

  const distPct  = Math.abs((price - ema21_15) / ema21_15);
  const touchPct = cfg.ema_touch_pct ?? 0.008;

  // Price must be within touch zone AND on the correct side
  const withinTouch = distPct <= touchPct;
  const correctSide = isLong
    ? price <= ema21_15 * 1.012  // pulling back from above (up to 1.2% above EMA21)
    : price >= ema21_15 * 0.988; // bouncing from below (up to 1.2% below EMA21)

  if (!withinTouch || !correctSide) {
    return _notTriggered(cfg, [
      ...rationale,
      `Tendência ${direction} confirmada no 1H, mas preço $${price.toFixed(0)} não está ` +
      `no pullback ao EMA21/${technical.timeframes?.entry ?? "15min"} ($${ema21_15.toFixed(0)})`,
      `Distância atual: ${(distPct * 100).toFixed(2)}% (zona de toque: ${(touchPct * 100).toFixed(1)}%)`,
      `Aguardar pullback ao EMA21 para entrada de alta probabilidade`,
    ]);
  }

  confidence += 25;
  rationale.push(
    `Toque no EMA21/${technical.timeframes?.entry ?? "15min"}: ` +
    `preço $${price.toFixed(0)} vs EMA21 $${ema21_15.toFixed(0)} ` +
    `(${(distPct * 100).toFixed(2)}% distância) ✓`
  );

  // ── Step 3: Reversal candle on 15min at the EMA21 ─────────────
  const lastBar = bars15[bars15.length - 1];
  const prevBar = bars15[bars15.length - 2];
  const candle  = _detectReversalCandle(lastBar, prevBar, direction);

  if (candle.found) {
    confidence += 20;
    rationale.push(`Vela de reversão no 15min: ${candle.type} ✓`);
  } else {
    rationale.push(
      `Nenhuma vela de reversão clara no 15min — entrada de menor qualidade ` +
      `(aguardar próxima barra para confirmação)`
    );
  }

  // ── Step 4: 1H RSI — not in extreme zone ──────────────────────
  // If RSI > 75 on 1H during a LONG, the trend is overextended and a
  // pullback buy is high-risk. Opposite for SHORT.
  const rsi1h = weekly.rsi;
  if (rsi1h !== null) {
    const notExtreme = isLong ? rsi1h < 75 : rsi1h > 25;
    if (notExtreme) {
      confidence += 10;
      rationale.push(
        `RSI 1H ${rsi1h.toFixed(1)} — sem sobreextensão ` +
        `(${isLong ? "<75" : ">25"}) ✓`
      );
    } else {
      confidence -= 20;
      rationale.push(
        `⚠ RSI 1H ${rsi1h.toFixed(1)} — ` +
        `${isLong ? "sobrecomprado (>75)" : "sobrevendido (<25)"}: ` +
        `pullback buy em overextension tem baixa probabilidade`
      );
    }
  }

  // ── Step 5: Weekly bias from real weekly indicators ────────────
  const wBias = _computeWeeklyBias(technical);
  if (wBias.bias !== "NEUTRAL") {
    const aligned = (isLong && wBias.bias === "BULLISH") ||
                    (!isLong && wBias.bias === "BEARISH");
    if (aligned) {
      confidence += 10;
      rationale.push(`Viés semanal ${wBias.bias}: alinhado com ${direction} ✓`);
    } else {
      confidence -= 15;
      rationale.push(
        `⚠ Viés semanal ${wBias.bias}: trade ${direction} vai CONTRA a tendência ` +
        `semanal — risco elevado de falha no setup`
      );
    }
  } else {
    rationale.push(`Viés semanal NEUTRO — sem bônus/penalidade direcional`);
  }

  // ── EMA200 context (informational, small bonus) ────────────────
  const ema200_15 = technical.daily?.ema200;
  if (ema200_15) {
    const above200 = price > ema200_15;
    if ((isLong && above200) || (!isLong && !above200)) {
      confidence += 5;
      rationale.push(
        `EMA200/${technical.timeframes?.entry ?? "15min"} $${ema200_15.toFixed(0)}: ` +
        `preço ${above200 ? "acima" : "abaixo"} — alinhado ✓`
      );
    } else {
      rationale.push(
        `EMA200/${technical.timeframes?.entry ?? "15min"} $${ema200_15.toFixed(0)}: ` +
        `preço ${above200 ? "acima" : "abaixo"} — contra a direção (contexto informativo)`
      );
    }
  }

  const triggered = confidence >= 55;
  if (!triggered) {
    rationale.push(
      `Confiança ${confidence}% — abaixo do mínimo de 55% para este setup`
    );
  }

  return {
    setup_id:   cfg.id,
    setup_name: cfg.name,
    triggered,
    direction,
    confidence: Math.min(Math.max(confidence, 0), 100),
    rationale,
    leverage:   cfg.leverage,
    sl_pct:     cfg.sl_pct,
    tp_r:       cfg.tp_r,
  };
}

// ── Setup 2: STH Realized Price — ALWAYS SHORT ─────────────────
// Isolated rule: fires as SHORT when BTC price converges toward
// the STH Realized Price (yellow line on bitcoinmagazinepro.com).
// 20x leverage, 10% SL — independent from all other strategy rules.

async function _evalSTHRealizedPrice(symbol, technical) {
  const cfg = SETUPS.STH_REALIZED_PRICE;
  if (!cfg.enabled || (cfg.symbols !== null && !cfg.symbols.includes(symbol))) {
    return _notTriggered(cfg);
  }

  const price = technical.price;
  const sth   = await getSTHRealizedPrice(price);
  const rationale = [];

  // ── STH price unavailable ─────────────────────────────────────
  if (!sth.price) {
    return _notTriggered(cfg, [
      "STH Realized Price não disponível (CoinGlass + bitcoinmagazinepro.com falharam)",
      "→ Adicione manualmente em rules.json: { \"sth_realized_price\": <valor_atual> }",
      "   Consulte: https://www.bitcoinmagazinepro.com/charts/short-term-holder-realized-price/",
    ]);
  }

  rationale.push(
    `STH Realized Price: $${sth.price.toLocaleString()} (fonte: ${sth.source})`
  );
  rationale.push(
    `BTC atual: $${price.toLocaleString()} — ${sth.touchProximityPct?.toFixed(2)}% ` +
    `${sth.priceAbove ? "ACIMA" : "ABAIXO"} da linha amarela`
  );
  if (sth.convergenceStatus) {
    rationale.push(`Trajetória: ${sth.convergenceStatus}`);
  }

  const proximity = sth.touchProximityPct ?? 99;
  const touchPct  = (cfg.touch_pct ?? 0.03) * 100;

  if (!sth.isNearLine) {
    return _notTriggered(cfg, [
      ...rationale,
      `Proximidade atual: ${proximity.toFixed(2)}% — threshold de entrada: ${touchPct.toFixed(1)}%.`,
      `Setup ficará ativo quando BTC se aproximar mais ${(proximity - touchPct).toFixed(1)}% da linha.`,
    ]);
  }

  const convergePP = cfg.converge_threshold_pct ?? 2;
  if (sth.historyLength >= 3 && !sth.isConverging && proximity > 0.5) {
    return _notTriggered(cfg, [
      ...rationale,
      `Preço dentro dos ${touchPct.toFixed(1)}% mas SEM CONVERGÊNCIA ativa.`,
      `Delta de proximidade: ${sth.proximityDelta?.toFixed(2) ?? "N/A"}pp ` +
      `(precisa ≤−${convergePP}pp para confirmar).`,
      `Aguardando que o preço mostre movimento direcional em direção à linha antes de entrar.`,
    ]);
  }

  const direction = "SHORT";
  let confidence  = 72;

  rationale.push(
    `⚡ CONVERGÊNCIA CONFIRMADA: BTC se aproximando da STH Realized Price ` +
    `($${sth.price.toLocaleString()})`
  );
  rationale.push(
    `TRADE ISOLADO — SHORT ${cfg.leverage}x | SL ${(cfg.sl_pct * 100).toFixed(0)}% acima da entrada`
  );

  if (sth.priceAbove) {
    confidence += 10;
    rationale.push(`BTC acima da linha (resistência confirmada) — SHORT alinhado com posição relativa`);
  } else {
    confidence += 5;
    rationale.push(
      `BTC abaixo da linha mas convergindo para ela — entrada antecipada ao toque para SHORT`
    );
  }

  const ema200 = technical.daily?.ema200;
  if (ema200) {
    const priceVsEma = price > ema200 ? "acima" : "abaixo";
    rationale.push(
      `EMA200 (${technical.daily?.timeframe ?? "15"}min): $${ema200.toFixed(0)} — BTC está ${priceVsEma}. ` +
      (price > ema200
        ? `SHORT vai CONTRA a tendência de curto prazo — SL 10% dá margem.`
        : `SHORT alinhado com fraqueza técnica ✓`)
    );
    if (price < ema200) confidence += 5;
  }

  rationale.push(
    `⚠ RISCO (${cfg.leverage}x, SL ${(cfg.sl_pct * 100).toFixed(0)}%): ` +
    `posição dimensionada para max 1% de perda do capital`
  );

  if (sth.historyLength) {
    rationale.push(
      `Monitor ativo há ${sth.historyLength} leituras (últimas ${sth.historyLength * 5}min)`
    );
  }

  return {
    setup_id:   cfg.id,
    setup_name: cfg.name,
    triggered:  true,
    direction,
    confidence: Math.min(Math.max(confidence, 0), 100),
    rationale,
    leverage:   cfg.leverage,
    sl_pct:     cfg.sl_pct,
    tp_r:       cfg.tp_r,
    sthPrice:          sth.price,
    sthProximityPct:   proximity,
    sthConverging:     sth.isConverging,
    sthDelta:          sth.proximityDelta,
  };
}

// ── Setup 3: S/R Breakout + Retest ────────────────────────────
// Identifies horizontal support/resistance from 1H swing highs/lows.
// Enters at the "level flip" retest on 15min — the point where
// former resistance becomes support (or vice versa).
//
// Why not RSI/MACD/StochRSI here: those weekly indicators barely
// move between 5-min scans and cannot time 15min entries. They belong
// in the weekly bias filter only (_computeWeeklyBias).

async function _evalSrBreakoutRetest(symbol, technical) {
  const cfg = SETUPS.SR_BREAKOUT_RETEST;
  if (!cfg.enabled || (cfg.symbols && !cfg.symbols.includes(symbol))) {
    return _notTriggered(cfg);
  }

  const price       = technical.price;
  const trend1hBars = technical.weekly?.bars ?? [];
  const entry15Bars = technical.daily?.bars  ?? [];
  const rationale   = [];

  if (trend1hBars.length < 10) {
    return _notTriggered(cfg, ["Barras do 1H insuficientes para detectar S/R (mín: 10)"]);
  }
  if (entry15Bars.length < 10) {
    return _notTriggered(cfg, ["Barras do 15min insuficientes para confirmar breakout (mín: 10)"]);
  }

  // ── Find swing highs/lows on 1H → horizontal S/R levels ───────
  const swings1h = _findSwings(trend1hBars, 3);
  const allLevels = [
    ...swings1h.highs.map((s) => ({ price: s.price, type: "R" })),
    ...swings1h.lows.map((s)  => ({ price: s.price, type: "S" })),
  ].filter((l) => l.price > 0);

  if (allLevels.length < 2) {
    return _notTriggered(cfg, [
      "S/R insuficiente no 1H — mercado sem estrutura de swing clara",
    ]);
  }

  const tolerance = cfg.retest_tolerance_pct ?? 0.015;

  // Nearest level(s) to current price
  const nearbyLevels = allLevels
    .map((l) => ({ ...l, dist: Math.abs((price - l.price) / l.price) }))
    .filter((l) => l.dist <= tolerance * 3) // within 4.5%
    .sort((a, b) => a.dist - b.dist);

  if (!nearbyLevels.length) {
    return _notTriggered(cfg, [
      `Nenhum nível S/R do 1H próximo ao preço atual ($${price.toFixed(0)})`,
      `Últimos níveis: ${allLevels.slice(-5).map((l) => `$${l.price.toFixed(0)} (${l.type})`).join(", ")}`,
    ]);
  }

  const nearLevel = nearbyLevels[0];

  // ── Detect 15min breakout: majority of recent bars on one side ─
  const recent15 = entry15Bars.slice(-10);
  const closesAbove = recent15.filter((b) => b.close > nearLevel.price).length;
  const closesBelow = recent15.filter((b) => b.close < nearLevel.price).length;

  // Need ≥6 of last 10 bars on the new side AND last 2 bars confirm
  const lastTwo = recent15.slice(-2);
  const brokeAbove =
    closesAbove >= 6 && lastTwo.every((b) => b.close > nearLevel.price);
  const brokeBelow =
    closesBelow >= 6 && lastTwo.every((b) => b.close < nearLevel.price);

  if (!brokeAbove && !brokeBelow) {
    return _notTriggered(cfg, [
      `Nível S/R encontrado: $${nearLevel.price.toFixed(0)} (${nearLevel.type}, ` +
      `${(nearLevel.dist * 100).toFixed(2)}% do preço)`,
      `Sem breakout confirmado — ` +
      `${closesAbove} barras acima / ${closesBelow} barras abaixo do nível`,
      `Aguardar fechamento limpo (6+ barras) de um lado para ativar o setup`,
    ]);
  }

  const direction   = brokeAbove ? "LONG" : "SHORT";
  const isLong      = direction === "LONG";
  const breakSide   = isLong ? "ACIMA" : "ABAIXO";
  let confidence    = 0;

  rationale.push(
    `Rompimento ${breakSide} do nível $${nearLevel.price.toFixed(0)} ` +
    `(${nearLevel.type}) confirmado no 15min: ` +
    `${isLong ? closesAbove : closesBelow}/10 barras na nova direção ✓`
  );
  confidence += 35;

  // ── Retest: price returned to the broken level ─────────────────
  const isRetesting = nearLevel.dist <= tolerance;

  if (!isRetesting) {
    // Broken but not yet retested — log progress, don't trigger yet
    return _notTriggered(cfg, [
      ...rationale,
      `Rompimento ok, mas SEM reteste ainda — preço $${price.toFixed(0)} ` +
      `está ${(nearLevel.dist * 100).toFixed(2)}% do nível $${nearLevel.price.toFixed(0)}`,
      `Aguardar pullback ao nível rompido para entrada de alta probabilidade`,
    ]);
  }

  confidence += 30;
  rationale.push(
    `Reteste em andamento: preço $${price.toFixed(0)} voltou ao nível ` +
    `$${nearLevel.price.toFixed(0)} (${(nearLevel.dist * 100).toFixed(2)}%) ✓`
  );

  // ── Reversal candle on 15min at the retest ─────────────────────
  const lastBar = entry15Bars[entry15Bars.length - 1];
  const prevBar = entry15Bars[entry15Bars.length - 2];
  const candle  = _detectReversalCandle(lastBar, prevBar, direction);

  if (candle.found) {
    confidence += 20;
    rationale.push(`Vela de reversão no reteste: ${candle.type} ✓`);
  } else {
    rationale.push(
      `Nenhuma vela de reversão clara no reteste — aguardar próxima barra (entrada de menor qualidade)`
    );
  }

  // ── EMA200 alignment ───────────────────────────────────────────
  const ema200 = technical.daily?.ema200;
  if (ema200) {
    const above200 = price > ema200;
    if ((isLong && above200) || (!isLong && !above200)) {
      confidence += 10;
      rationale.push(
        `EMA200 $${ema200.toFixed(0)}: preço ${above200 ? "acima" : "abaixo"} — alinhado com ${direction} ✓`
      );
    } else {
      rationale.push(
        `EMA200 $${ema200.toFixed(0)}: preço ${above200 ? "acima" : "abaixo"} — ` +
        `contra o trade (confirmar outros fatores antes de entrar)`
      );
    }
  }

  // ── Weekly bias bonus/penalty ──────────────────────────────────
  const wBias = _computeWeeklyBias(technical);
  if (wBias.bias !== "NEUTRAL") {
    const aligned = (isLong && wBias.bias === "BULLISH") ||
                    (!isLong && wBias.bias === "BEARISH");
    if (aligned) {
      confidence += 10;
      rationale.push(`Viés semanal ${wBias.bias}: alinhado com ${direction} ✓`);
    } else {
      confidence -= 10;
      rationale.push(`⚠ Viés semanal ${wBias.bias}: trade ${direction} vai CONTRA a tendência semanal`);
    }
  }

  const triggered = confidence >= 60;
  if (!triggered) {
    rationale.push(`Confiança ${confidence}% — mínimo 60% para este setup`);
  }

  return {
    setup_id:   cfg.id,
    setup_name: cfg.name,
    triggered,
    direction,
    confidence: Math.min(Math.max(confidence, 0), 100),
    rationale,
    leverage:   cfg.leverage,
    sl_pct:     cfg.sl_pct,
    tp_r:       cfg.tp_r,
  };
}

// ── Setup 4: Open Interest Confirmation ───────────────────────
// This is primarily a filter used by other setups.
// Returns a standalone signal only when OI change is very strong
// AND price is clearly trending (EMA alignment).

async function _evalOIConfirmation(symbol, onchain, technical) {
  const cfg = SETUPS.OI_CONFIRMATION;
  if (!cfg.enabled || (cfg.symbols !== null && !cfg.symbols.includes(symbol))) {
    return _notTriggered(cfg);
  }

  const oi = onchain?.openInterest;
  if (!oi) {
    return _notTriggered(cfg, ["Dados de Open Interest não disponíveis"]);
  }

  const rationale = [];
  let direction   = null;
  let confidence  = 0;
  let oiStrength  = "NEUTRAL";

  const oiChange = oi.change24hPct ?? oi.changePct ?? null;
  if (oiChange === null) {
    return _notTriggered(cfg, ["Variação de OI (24h) não disponível na fonte de dados"]);
  }

  if (oiChange > cfg.oi_change_threshold) {
    oiStrength = "STRONG";
    confidence += 40;

    const ema200 = technical.daily?.ema200;
    const ema21w = technical.weekly?.ema21;
    const price  = technical.price;

    if (ema200 && price > ema200) {
      direction = "LONG";
      confidence += 30;
      rationale.push(`OI aumentou +${oiChange.toFixed(2)}% (24h) — tendência de ALTA sendo fortalecida`);
      rationale.push(`Preço $${price.toFixed(0)} acima da EMA200 ($${ema200.toFixed(0)}) confirma direção LONG`);
    } else if (ema200 && price < ema200) {
      direction = "SHORT";
      confidence += 30;
      rationale.push(`OI aumentou +${oiChange.toFixed(2)}% (24h) — tendência de BAIXA sendo fortalecida`);
      rationale.push(`Preço $${price.toFixed(0)} abaixo da EMA200 ($${ema200.toFixed(0)}) confirma direção SHORT`);
    } else {
      rationale.push(`OI aumentou +${oiChange.toFixed(2)}% — sem EMA200 para confirmar direção`);
    }

    if (ema21w) {
      const above = technical.price > ema21w;
      rationale.push(
        `EMA21 1H em $${ema21w.toFixed(0)} — preço ${above ? "acima" : "abaixo"} ` +
        `(${above ? "bullish" : "bearish"})`
      );
      if ((direction === "LONG" && above) || (direction === "SHORT" && !above)) confidence += 10;
    }

  } else if (oiChange < -cfg.oi_change_threshold) {
    oiStrength = "WEAK";
    rationale.push(`OI caiu ${oiChange.toFixed(2)}% (24h) — tendência ENFRAQUECENDO, posições sendo fechadas`);
    rationale.push("Evitar novas entradas enquanto OI decresce — confirma saída de capital");
    return {
      setup_id:   cfg.id,
      setup_name: cfg.name,
      triggered:  false,
      direction:  null,
      confidence: 0,
      rationale,
      leverage:   cfg.leverage,
      sl_pct:     cfg.sl_pct,
      tp_r:       cfg.tp_r,
      oiStrength,
      oiChange,
    };

  } else {
    oiStrength = "NEUTRAL";
    rationale.push(`OI variou ${oiChange.toFixed(2)}% (24h) — dentro da faixa neutra (±${cfg.oi_change_threshold}%)`);
    rationale.push("OI neutro não filtra nem confirma o trade");
  }

  const triggered = cfg.filterOnly
    ? false
    : (direction !== null && confidence >= 60);

  return {
    setup_id:   cfg.id,
    setup_name: cfg.name,
    triggered,
    direction,
    confidence: Math.min(confidence, 100),
    rationale,
    leverage:   cfg.leverage,
    sl_pct:     cfg.sl_pct,
    tp_r:       cfg.tp_r,
    oiStrength,
    oiChange,
  };
}

// ── Setup 5: Liquidation Zone Accumulation ────────────────────

async function _evalLiquidationZone(symbol, technical) {
  const cfg = SETUPS.LIQUIDATION_ZONE;
  if (!cfg.enabled || (cfg.symbols !== null && !cfg.symbols.includes(symbol))) {
    return _notTriggered(cfg);
  }

  const price = technical.price;
  const liq   = await analyzeLiquidations(price);

  if (!liq.available) {
    return _notTriggered(cfg, liq.rationale);
  }

  if (liq.signal === "NEUTRAL") {
    return _notTriggered(cfg, liq.rationale);
  }

  const dominantRatio = liq.signal === "LONG" ? liq.aboveRatio : (1 - liq.aboveRatio);
  if (dominantRatio < cfg.zone_dominance_threshold) {
    return _notTriggered(cfg, [
      ...liq.rationale,
      `Dominância ${(dominantRatio * 100).toFixed(1)}% abaixo do mínimo ${(cfg.zone_dominance_threshold * 100).toFixed(0)}%`,
    ]);
  }

  const confidence = Math.min(
    Math.round(50 + (dominantRatio - cfg.zone_dominance_threshold) * 200),
    95
  );

  const rationale = [...liq.rationale];

  const ema200 = technical.daily?.ema200;
  if (ema200) {
    const aligned = (liq.direction === "LONG" && price > ema200) ||
                    (liq.direction === "SHORT" && price < ema200);
    rationale.push(
      `EMA200 $${ema200.toFixed(0)}: ${aligned ? "confirma" : "CONTRA"} a direção ${liq.direction}`
    );
  }

  return {
    setup_id:   cfg.id,
    setup_name: cfg.name,
    triggered:  true,
    direction:  liq.direction,
    confidence,
    rationale,
    leverage:   cfg.leverage,
    sl_pct:     cfg.sl_pct,
    tp_r:       cfg.tp_r,
    liqData: {
      aboveTotal:    liq.aboveTotal,
      belowTotal:    liq.belowTotal,
      aboveRatio:    liq.aboveRatio,
      topAbovePrice: liq.topAbovePrice,
      topBelowPrice: liq.topBelowPrice,
    },
  };
}

// ── OI Filter Application ─────────────────────────────────────
// Adjusts confidence of a triggered setup based on OI direction.

function _applyOiFilter(setupResult, oiResult) {
  if (!oiResult || oiResult.oiStrength === "NEUTRAL") return setupResult;

  const sameDirection = oiResult.direction === setupResult.direction;

  if (oiResult.oiStrength === "STRONG" && sameDirection) {
    return {
      ...setupResult,
      confidence: Math.min(setupResult.confidence + 10, 100),
      rationale: [
        ...setupResult.rationale,
        `Setup 4 confirma: OI subiu +${oiResult.oiChange?.toFixed(2)}% — tendência fortalecida (+10 confiança)`,
      ],
    };
  }

  if (oiResult.oiStrength === "STRONG" && !sameDirection) {
    return {
      ...setupResult,
      confidence: Math.max(setupResult.confidence - 20, 0),
      rationale: [
        ...setupResult.rationale,
        `⚠ Setup 4 CONTRA: OI subindo na direção oposta — tendência contrária (-20 confiança)`,
      ],
    };
  }

  if (oiResult.oiStrength === "WEAK") {
    return {
      ...setupResult,
      confidence: Math.max(setupResult.confidence - 15, 0),
      rationale: [
        ...setupResult.rationale,
        `⚠ Setup 4 alerta: OI caindo ${oiResult.oiChange?.toFixed(2)}% — tendência enfraquecendo (-15 confiança)`,
      ],
    };
  }

  return setupResult;
}

// ── Weekly Bias Computation ────────────────────────────────────
/**
 * Compute directional bias from real weekly RSI / MACD / StochRSI.
 * These indicators are ONLY used as a directional gate/bonus here —
 * NOT as entry triggers. They answer: "does the weekly macro support this direction?"
 *
 * Returns { bias: "BULLISH"|"BEARISH"|"NEUTRAL", bullScore, bearScore, reasons[] }
 */
function _computeWeeklyBias(technical) {
  const wk = technical.weeklyFixed;
  if (!wk) return { bias: "NEUTRAL", bullScore: 0, bearScore: 0, reasons: ["Weekly data unavailable"] };

  let bullScore = 0;
  let bearScore = 0;
  const reasons = [];

  // RSI Weekly
  if (wk.rsi !== null) {
    if (wk.rsi > 55) {
      bullScore++;
      reasons.push(`RSI W ${wk.rsi.toFixed(1)} > 55 (momentum bullish)`);
    } else if (wk.rsi < 45) {
      bearScore++;
      reasons.push(`RSI W ${wk.rsi.toFixed(1)} < 45 (momentum bearish)`);
    } else {
      reasons.push(`RSI W ${wk.rsi.toFixed(1)} neutro (45–55)`);
    }
  }

  // MACD Weekly
  if (wk.macd) {
    const { histogram, crossingUp, crossingDown } = wk.macd;
    if (histogram > 0 || crossingUp) {
      bullScore++;
      reasons.push(`MACD W positivo (hist: ${histogram?.toFixed(0) ?? "?"})${crossingUp ? " — cruzamento de alta!" : ""}`);
    } else if (histogram < 0 || crossingDown) {
      bearScore++;
      reasons.push(`MACD W negativo (hist: ${histogram?.toFixed(0) ?? "?"})${crossingDown ? " — cruzamento de baixa!" : ""}`);
    }
  }

  // StochRSI Weekly
  if (wk.stochRsi) {
    const { k, d, crossingUp, crossingDown, overbought, oversold } = wk.stochRsi;
    if (crossingUp || (k > d && !overbought)) {
      bullScore++;
      reasons.push(`StochRSI W %K(${k}) > %D(${d})${crossingUp ? " — cruzamento bullish!" : ""}`);
    } else if (crossingDown || (k < d && !oversold)) {
      bearScore++;
      reasons.push(`StochRSI W %K(${k}) < %D(${d})${crossingDown ? " — cruzamento bearish!" : ""}`);
    } else {
      reasons.push(`StochRSI W ${overbought ? "sobrecomprado" : oversold ? "sobrevendido" : "neutro"} (%K=${k}, %D=${d})`);
    }
  }

  // Need 2 of 3 indicators aligned for a clear bias
  let bias = "NEUTRAL";
  if (bullScore >= 2) bias = "BULLISH";
  else if (bearScore >= 2) bias = "BEARISH";

  return { bias, bullScore, bearScore, reasons };
}

// ── Swing High/Low Detection ───────────────────────────────────

function _findSwings(bars, lookback = 3) {
  const highs = [];
  const lows  = [];

  for (let i = lookback; i < bars.length - lookback; i++) {
    const isSwingHigh =
      bars.slice(i - lookback, i).every((b) => b.high <= bars[i].high) &&
      bars.slice(i + 1, i + lookback + 1).every((b) => b.high <= bars[i].high);
    const isSwingLow =
      bars.slice(i - lookback, i).every((b) => b.low >= bars[i].low) &&
      bars.slice(i + 1, i + lookback + 1).every((b) => b.low >= bars[i].low);

    if (isSwingHigh) highs.push({ idx: i, price: bars[i].high });
    if (isSwingLow)  lows.push({ idx: i, price: bars[i].low });
  }

  return { highs, lows };
}

// ── Reversal Candle Detection ──────────────────────────────────

function _detectReversalCandle(bar, prevBar, direction) {
  if (!bar || !prevBar) return { found: false };

  const bodySize  = Math.abs(bar.close - bar.open);
  const totalSize = bar.high - bar.low;
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;

  if (direction === "LONG") {
    if (bar.close > bar.open && bar.open < prevBar.close && bar.close > prevBar.open) {
      return { found: true, type: "Engulfing de alta" };
    }
    if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.5) {
      return { found: true, type: "Martelo (hammer)" };
    }
    if (lowerWick > totalSize * 0.6 && bar.close > bar.open) {
      return { found: true, type: "Pin bar de alta" };
    }
  }

  if (direction === "SHORT") {
    if (bar.close < bar.open && bar.open > prevBar.close && bar.close < prevBar.open) {
      return { found: true, type: "Engulfing de baixa" };
    }
    if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.5) {
      return { found: true, type: "Shooting star" };
    }
    if (upperWick > totalSize * 0.6 && bar.close < bar.open) {
      return { found: true, type: "Pin bar de baixa" };
    }
  }

  return { found: false };
}

// ── Helpers ────────────────────────────────────────────────────

function _notTriggered(cfg, rationale = []) {
  return {
    setup_id:   cfg.id,
    setup_name: cfg.name,
    triggered:  false,
    direction:  null,
    confidence: 0,
    rationale,
    leverage:   cfg.leverage,
    sl_pct:     cfg.sl_pct,
    tp_r:       cfg.tp_r,
  };
}
