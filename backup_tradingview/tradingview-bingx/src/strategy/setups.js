// ─────────────────────────────────────────────────────────────────
//  Setup Evaluators
//  Each of the 5 named setups has its own trigger logic.
//  Every evaluator returns a SetupResult explaining WHY a trade
//  was entered — the rationale is shown in the dashboard before approval.
//
//  SetupResult shape:
//  {
//    setup_id:    string,        // e.g. "TRENDLINE_BREAKOUT"
//    setup_name:  string,        // human-readable name
//    triggered:   boolean,       // true = setup conditions met
//    direction:   "LONG"|"SHORT"|null,
//    confidence:  number,        // 0–100 (how strong the signal is)
//    rationale:   string[],      // ordered list: strongest reason first
//    leverage:    number,        // from SETUPS config
//    sl_pct:      number,        // stop-loss distance as fraction of price
//    tp_r:        object,        // TP R-multiples { tp1, tp2, tp3 }
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
    _evalTrendlineBreakout(symbol, technical),
    _evalSTHRealizedPrice(symbol, technical),
    _evalRsiStochMacd(symbol, technical),
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

// ── Setup 1: Trendline Breakout + Retest ──────────────────────
// Uses daily OHLCV bars to:
// 1. Find swing highs/lows (local extrema) in the last 30 bars
// 2. Fit a trendline (LTB through lower highs / LTA through higher lows)
// 3. Check if price recently broke the trendline (within last 3 bars)
// 4. Check if a retest of the broken line occurred
// 5. Check for reversal candle (engulfing, hammer, shooting star)

async function _evalTrendlineBreakout(symbol, technical) {
  const cfg = SETUPS.TRENDLINE_BREAKOUT;
  if (!cfg.enabled || !cfg.symbols.includes(symbol)) {
    return _notTriggered(cfg);
  }

  const bars = technical.daily?.bars ?? [];
  if (bars.length < 15) {
    return _notTriggered(cfg, ["Barras diárias insuficientes para análise de tendência"]);
  }

  const price = technical.price;
  const rationale = [];
  let direction = null;
  let confidence = 0;

  // Find swing highs and lows
  const swings = _findSwings(bars);
  const { highs, lows } = swings;

  // ── LTB detection (downtrend line through lower highs) ──────
  const ltbResult = _fitTrendline(highs, bars.length);
  // ── LTA detection (uptrend line through higher lows) ────────
  const ltaResult = _fitTrendline(lows, bars.length);

  // Check if price has crossed either trendline in the last 3 bars
  const recentBars = bars.slice(-5);
  const prevClose  = bars[bars.length - 4]?.close ?? price;

  // LTB breakout (bearish line broke up → LONG)
  if (ltbResult && ltbResult.direction === "DOWN") {
    const ltbPriceNow  = _evalTrendlineAt(ltbResult, bars.length - 1);
    const ltbPricePrev = _evalTrendlineAt(ltbResult, bars.length - 4);

    if (ltbPricePrev !== null && prevClose < ltbPricePrev && price > ltbPriceNow) {
      direction  = "LONG";
      confidence += 35;
      rationale.push(
        `Rompimento de LTB (linha de tendência de baixa) confirmado: preço cruzou de $${ltbPricePrev?.toFixed(0)} → acima de $${ltbPriceNow?.toFixed(0)}`
      );
    }
  }

  // LTA breakout (bullish line broke down → SHORT)
  if (!direction && ltaResult && ltaResult.direction === "UP") {
    const ltaPriceNow  = _evalTrendlineAt(ltaResult, bars.length - 1);
    const ltaPricePrev = _evalTrendlineAt(ltaResult, bars.length - 4);

    if (ltaPricePrev !== null && prevClose > ltaPricePrev && price < ltaPriceNow) {
      direction  = "SHORT";
      confidence += 35;
      rationale.push(
        `Rompimento de LTA (linha de tendência de alta) confirmado: preço cruzou abaixo de $${ltaPriceNow?.toFixed(0)}`
      );
    }
  }

  if (!direction) {
    return _notTriggered(cfg, ["Nenhum rompimento de LTB/LTA detectado nas últimas barras"]);
  }

  // ── S/R horizontal check ────────────────────────────────────
  // Last significant top (resistance) and bottom (support)
  const lastHigh = highs[highs.length - 1];
  const lastLow  = lows[lows.length - 1];

  if (direction === "LONG" && lastLow) {
    const supportDist = Math.abs((price - lastLow.price) / price * 100);
    if (supportDist < 3) {
      confidence += 15;
      rationale.push(
        `Suporte horizontal confirmado no último fundo: $${lastLow.price.toFixed(0)} (${supportDist.toFixed(1)}% abaixo do preço atual)`
      );
    } else {
      rationale.push(`Fundo relevante em $${lastLow.price.toFixed(0)} (${supportDist.toFixed(1)}% abaixo — suporte distante)`);
    }
  }

  if (direction === "SHORT" && lastHigh) {
    const resDist = Math.abs((lastHigh.price - price) / price * 100);
    if (resDist < 3) {
      confidence += 15;
      rationale.push(
        `Resistência horizontal confirmada no último topo: $${lastHigh.price.toFixed(0)} (${resDist.toFixed(1)}% acima do preço atual)`
      );
    }
  }

  // ── Retest detection ────────────────────────────────────────
  // Price came back close to the broken trendline after breakout
  const trendlineNow = direction === "LONG"
    ? _evalTrendlineAt(ltbResult, bars.length - 1)
    : _evalTrendlineAt(ltaResult, bars.length - 1);

  if (trendlineNow) {
    const retestDist = Math.abs((price - trendlineNow) / trendlineNow * 100);
    if (retestDist < 1.5) {
      confidence += 25;
      rationale.push(
        `Reteste da linha rompida em andamento: preço atual $${price.toFixed(0)} vs. linha em $${trendlineNow.toFixed(0)} (${retestDist.toFixed(1)}% de distância)`
      );
    } else if (retestDist < 3) {
      confidence += 10;
      rationale.push(
        `Reteste próximo à linha rompida: ${retestDist.toFixed(1)}% de distância (tolerância 1.5%)`
      );
    } else {
      rationale.push(`Sem reteste claro — preço ${retestDist.toFixed(1)}% afastado da linha rompida`);
    }
  }

  // ── Reversal candle check ───────────────────────────────────
  const lastBar = bars[bars.length - 1];
  const prevBar = bars[bars.length - 2];
  const candleSignal = _detectReversalCandle(lastBar, prevBar, direction);
  if (candleSignal.found) {
    confidence += 20;
    rationale.push(`Vela de reversão detectada: ${candleSignal.type} (${direction === "LONG" ? "bullish" : "bearish"})`);
  } else {
    rationale.push(`Nenhuma vela de reversão clara na barra atual — aguardar confirmação`);
  }

  // EMA200 alignment (bonus context)
  const ema200 = technical.daily.ema200;
  if (ema200) {
    const emaContext = direction === "LONG"
      ? `Preço ${price > ema200 ? "acima" : "abaixo"} da EMA200 diária ($${ema200.toFixed(0)}) — ${price > ema200 ? "favorece" : "contra"} o setup LONG`
      : `Preço ${price < ema200 ? "abaixo" : "acima"} da EMA200 diária ($${ema200.toFixed(0)}) — ${price < ema200 ? "favorece" : "contra"} o setup SHORT`;
    rationale.push(emaContext);
    if ((direction === "LONG" && price > ema200) || (direction === "SHORT" && price < ema200)) {
      confidence += 5;
    }
  }

  const triggered = confidence >= 50; // Need breakout + at least retest OR candle
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
  };
}

// ── Setup 2: STH Realized Price Touch ─────────────────────────

async function _evalSTHRealizedPrice(symbol, technical) {
  const cfg = SETUPS.STH_REALIZED_PRICE;
  if (!cfg.enabled || !cfg.symbols.includes(symbol)) {
    return _notTriggered(cfg);
  }

  const price = technical.price;
  const sth   = await getSTHRealizedPrice(price);
  const rationale = [];

  if (!sth.price) {
    return _notTriggered(cfg, [
      "STH Realized Price não disponível",
      "Adicione manualmente em rules.json: { \"sth_realized_price\": <valor> }",
    ]);
  }

  rationale.push(
    `STH Realized Price: $${sth.price.toLocaleString()} (fonte: ${sth.source})`
  );
  rationale.push(
    `Preço atual $${price.toLocaleString()} está ${sth.touchProximityPct?.toFixed(2)}% ${sth.priceAbove ? "acima" : "abaixo"} da linha`
  );

  if (!sth.isNearLine) {
    return _notTriggered(cfg, [
      ...rationale,
      `Proximidade ${sth.touchProximityPct?.toFixed(2)}% — threshold é ${(cfg.touch_pct * 100).toFixed(1)}%. Preço ainda longe da linha.`,
    ]);
  }

  // ── AVISO DE RISCO: 30x leverage ─────────────────────────────
  // Com 30x, um movimento adverso de ~3.3% liquida a posição inteira.
  // O setup só pode ser aprovado se a entrada for CIRÚRGICA:
  // - Preço tocando a linha (não já afastado >0.5% dela)
  // - Vela de reversão presente na barra atual
  // Se esses critérios não forem atendidos, o setup NÃO dispara.
  const lastDailyBar = technical.daily?.bars?.[technical.daily.bars.length - 1];
  const prevDailyBar = technical.daily?.bars?.[technical.daily.bars.length - 2];
  const entryProximity = sth.touchProximityPct ?? 99;

  // Exigir que o preço ainda esteja dentro de 0.8% da linha (não "já passou")
  if (entryProximity > 0.8) {
    return _notTriggered(cfg, [
      ...rationale,
      `⚠ Entrada não cirúrgica: preço já se afastou ${entryProximity.toFixed(2)}% da linha STH.`,
      `Com ${cfg.leverage}x, movimentos de >3% liquidam a posição. Aguardar novo toque.`,
    ]);
  }

  // Determinar direção
  let direction = sth.priceAbove ? "LONG" : "SHORT";
  let confidence = 70;

  // Verificar vela de reversão (obrigatória para 30x)
  const candleOk = lastDailyBar && prevDailyBar
    ? _detectReversalCandle(lastDailyBar, prevDailyBar, direction)
    : { found: false };

  if (!candleOk.found) {
    return _notTriggered(cfg, [
      ...rationale,
      `⚠ Sem vela de reversão confirmada — entrada ${cfg.leverage}x BLOQUEADA.`,
      `Com alavancagem de ${cfg.leverage}x, é obrigatório ter engulfing, hammer ou pin bar na barra atual antes de entrar.`,
      `Aguardar fechamento da próxima barra diária para reavaliação.`,
    ]);
  }

  confidence = 80;
  if (sth.priceAbove) {
    rationale.push(`Preço tocando STH Realized Price como SUPORTE — bounce esperado para cima`);
    rationale.push(`Vela de reversão confirmada: ${candleOk.type}`);
    rationale.push(`SL ${(cfg.sl_pct * 100).toFixed(1)}% abaixo — rompimento da linha invalida o trade`);
  } else {
    rationale.push(`Preço tocando STH Realized Price como RESISTÊNCIA — rejeição esperada`);
    rationale.push(`Vela de reversão confirmada: ${candleOk.type}`);
    rationale.push(`SL ${(cfg.sl_pct * 100).toFixed(1)}% acima — rompimento para cima invalida o trade`);
  }

  // EMA200 context
  const ema200 = technical.daily?.ema200;
  if (ema200) {
    const aligned = (direction === "LONG" && price > ema200) || (direction === "SHORT" && price < ema200);
    rationale.push(
      `EMA200 diária em $${ema200.toFixed(0)} — ${aligned ? "alinhada ✓" : "⚠ CONTRA"} com a direção ${direction}`
    );
    if (aligned) confidence += 10;
    else {
      confidence -= 15; // penalidade maior: 30x contra tendência é perigoso
      rationale.push(`⚠ Setup 2 contra EMA200: risco elevado com ${cfg.leverage}x — confiança reduzida`);
    }
  }

  rationale.push(
    `Alavancagem ${cfg.leverage}x justificada pela precisão histórica do STH Realized Price como S/R de longo prazo`
  );
  rationale.push(
    `RISCO REAL: com ${cfg.leverage}x, movimento adverso de ${(100 / cfg.leverage).toFixed(1)}% = perda total da posição`
  );

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
    sthPrice:   sth.price,
  };
}

// ── Setup 3: RSI + StochRSI + MACD Triple Alignment ───────────

async function _evalRsiStochMacd(symbol, technical) {
  const cfg = SETUPS.RSI_STOCH_MACD;
  if (!cfg.enabled || !cfg.symbols.includes(symbol)) {
    return _notTriggered(cfg);
  }

  const weekly    = technical.weekly;
  const rationale = [];
  let score = 0;
  let direction = null;
  const votes = { LONG: 0, SHORT: 0 };

  // ── RSI ──────────────────────────────────────────────────────
  if (weekly.rsi !== null) {
    const rsi = weekly.rsi;
    if (rsi > 50 && rsi < 75) {
      votes.LONG++;
      score += 30;
      rationale.push(`RSI semanal ${rsi.toFixed(1)} — zona BULLISH (50–75): momentum de alta ativo`);
    } else if (rsi < 50 && rsi > 25) {
      votes.SHORT++;
      score += 30;
      rationale.push(`RSI semanal ${rsi.toFixed(1)} — zona BEARISH (25–50): momentum de baixa ativo`);
    } else if (rsi >= 75) {
      votes.SHORT += 0.5; // slight bearish (overbought)
      rationale.push(`RSI semanal ${rsi.toFixed(1)} — sobrecomprado: possível reversão de baixa, mas confirmar`);
    } else if (rsi <= 25) {
      votes.LONG += 0.5; // slight bullish (oversold)
      rationale.push(`RSI semanal ${rsi.toFixed(1)} — sobrevendido: possível reversão de alta, mas confirmar`);
    } else {
      rationale.push(`RSI semanal ${rsi.toFixed(1)} — zona neutra (50), sem viés claro`);
    }
  } else {
    rationale.push("RSI semanal: dados insuficientes");
  }

  // ── StochRSI ─────────────────────────────────────────────────
  const stoch = weekly.stochRsi;
  if (stoch) {
    if (stoch.crossingUp) {
      votes.LONG++;
      score += 35;
      rationale.push(
        `StochRSI semanal cruzando para CIMA: %K(${stoch.k}) cruzou acima %D(${stoch.d}) — sinal de compra`
      );
    } else if (stoch.crossingDown) {
      votes.SHORT++;
      score += 35;
      rationale.push(
        `StochRSI semanal cruzando para BAIXO: %K(${stoch.k}) cruzou abaixo %D(${stoch.d}) — sinal de venda`
      );
    } else if (stoch.k > stoch.d && !stoch.overbought) {
      votes.LONG += 0.5;
      score += 15;
      rationale.push(`StochRSI semanal: %K(${stoch.k}) acima %D(${stoch.d}) — momentum de alta (sem cruzamento recente)`);
    } else if (stoch.k < stoch.d && !stoch.oversold) {
      votes.SHORT += 0.5;
      score += 15;
      rationale.push(`StochRSI semanal: %K(${stoch.k}) abaixo %D(${stoch.d}) — momentum de baixa (sem cruzamento recente)`);
    } else {
      rationale.push(`StochRSI semanal: ${stoch.overbought ? "sobrecomprado" : stoch.oversold ? "sobrevendido" : "sem sinal claro"} (%K=${stoch.k}, %D=${stoch.d})`);
    }
  } else {
    rationale.push("StochRSI semanal: dados insuficientes (precisa de mais barras históricas)");
  }

  // ── MACD Weekly ──────────────────────────────────────────────
  const macd = weekly.macd;
  if (macd) {
    if (macd.crossingUp) {
      votes.LONG++;
      score += 35;
      rationale.push(
        `MACD semanal CRUZAMENTO DE ALTA: histograma mudou de negativo → positivo (${macd.histogram.toFixed(0)})`
      );
    } else if (macd.crossingDown) {
      votes.SHORT++;
      score += 35;
      rationale.push(
        `MACD semanal CRUZAMENTO DE BAIXA: histograma mudou de positivo → negativo (${macd.histogram.toFixed(0)})`
      );
    } else if (macd.histogram > 0) {
      votes.LONG += 0.5;
      score += 15;
      rationale.push(`MACD semanal: histograma positivo (${macd.histogram.toFixed(0)}) — tendência de alta em vigor`);
    } else {
      votes.SHORT += 0.5;
      score += 15;
      rationale.push(`MACD semanal: histograma negativo (${macd.histogram.toFixed(0)}) — tendência de baixa em vigor`);
    }
  } else {
    rationale.push("MACD semanal: dados insuficientes");
  }

  // ── Decision ─────────────────────────────────────────────────
  direction = votes.LONG >= votes.SHORT ? "LONG" : "SHORT";
  const alignment = votes[direction] / (votes.LONG + votes.SHORT || 1);

  // Need at least 2 of 3 indicators aligned AND at least one crossover
  const crossovers = (stoch?.crossingUp || stoch?.crossingDown ? 1 : 0) +
                     (macd?.crossingUp  || macd?.crossingDown  ? 1 : 0);
  const hasMinIndicators = votes[direction] >= 2;
  const triggered = hasMinIndicators && crossovers >= 1;

  if (!triggered) {
    rationale.push(
      crossovers === 0
        ? "Sem cruzamento ativo no StochRSI ou MACD — aguardar mudança de cor"
        : `Apenas ${Math.floor(votes[direction])} de 3 indicadores alinhados — confluência insuficiente`
    );
  } else {
    rationale.unshift(
      `TRIPLE CONFLUÊNCIA ${direction}: ${crossovers} cruzamento(s) ativo(s) + ${Math.floor(votes[direction])} indicadores alinhados`
    );
  }

  const confidence = triggered ? Math.min(Math.round(score * alignment), 100) : 0;

  return {
    setup_id:   cfg.id,
    setup_name: cfg.name,
    triggered,
    direction,
    confidence,
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
  if (!cfg.enabled || !cfg.symbols.includes(symbol)) {
    return _notTriggered(cfg);
  }

  const oi = onchain?.openInterest;
  if (!oi) {
    return _notTriggered(cfg, ["Dados de Open Interest não disponíveis"]);
  }

  const rationale = [];
  let direction   = null;
  let confidence  = 0;
  let oiStrength  = "NEUTRAL"; // exposed for applyOiFilter

  // OI change in 24h (requires current + previous OI)
  const oiChange = oi.change24hPct ?? oi.changePct ?? null;

  if (oiChange === null) {
    return _notTriggered(cfg, ["Variação de OI (24h) não disponível na fonte de dados"]);
  }

  const absChange = Math.abs(oiChange);

  if (oiChange > cfg.oi_change_threshold) {
    // OI increasing — trend strengthening
    oiStrength = "STRONG";
    confidence += 40;

    // Determine direction from price trend (EMA alignment)
    const ema200 = technical.daily?.ema200;
    const ema21w = technical.weekly?.ema21;
    const price  = technical.price;

    if (ema200 && price > ema200) {
      direction = "LONG";
      confidence += 30;
      rationale.push(`OI aumentou +${oiChange.toFixed(2)}% (24h) — tendência de ALTA sendo fortalecida`);
      rationale.push(`Preço $${price.toFixed(0)} acima da EMA200 diária ($${ema200.toFixed(0)}) confirma direção LONG`);
    } else if (ema200 && price < ema200) {
      direction = "SHORT";
      confidence += 30;
      rationale.push(`OI aumentou +${oiChange.toFixed(2)}% (24h) — tendência de BAIXA sendo fortalecida`);
      rationale.push(`Preço $${price.toFixed(0)} abaixo da EMA200 diária ($${ema200.toFixed(0)}) confirma direção SHORT`);
    } else {
      rationale.push(`OI aumentou +${oiChange.toFixed(2)}% — sem EMA200 para confirmar direção`);
    }

    if (ema21w) {
      const above = technical.price > ema21w;
      rationale.push(`EMA21 semanal em $${ema21w.toFixed(0)} — preço ${above ? "acima" : "abaixo"} (${above ? "bullish" : "bearish"})`);
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
    ? false // filter-only: never generates standalone signals
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
  if (!cfg.enabled || !cfg.symbols.includes(symbol)) {
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

  // Check minimum dominance threshold
  const dominantRatio = liq.signal === "LONG" ? liq.aboveRatio : (1 - liq.aboveRatio);
  if (dominantRatio < cfg.zone_dominance_threshold) {
    return _notTriggered(cfg, [
      ...liq.rationale,
      `Dominância ${(dominantRatio * 100).toFixed(1)}% abaixo do mínimo ${(cfg.zone_dominance_threshold * 100).toFixed(0)}%`,
    ]);
  }

  // Confidence based on how dominant the cluster is
  const confidence = Math.min(
    Math.round(50 + (dominantRatio - cfg.zone_dominance_threshold) * 200),
    95
  );

  const rationale = [...liq.rationale];

  // Add EMA context
  const ema200 = technical.daily?.ema200;
  if (ema200) {
    const aligned = (liq.direction === "LONG" && price > ema200) || (liq.direction === "SHORT" && price < ema200);
    rationale.push(
      `EMA200 diária $${ema200.toFixed(0)}: ${aligned ? "confirma" : "CONTRA"} a direção ${liq.direction}`
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
      aboveTotal:     liq.aboveTotal,
      belowTotal:     liq.belowTotal,
      aboveRatio:     liq.aboveRatio,
      topAbovePrice:  liq.topAbovePrice,
      topBelowPrice:  liq.topBelowPrice,
    },
  };
}

// ── OI Filter Application ─────────────────────────────────────
// Adjusts confidence of a triggered setup based on OI direction.

function _applyOiFilter(setupResult, oiResult) {
  if (!oiResult || oiResult.oiStrength === "NEUTRAL") return setupResult;

  const sameDirection = oiResult.direction === setupResult.direction;

  if (oiResult.oiStrength === "STRONG" && sameDirection) {
    const boost = Math.min(setupResult.confidence + 10, 100);
    return {
      ...setupResult,
      confidence: boost,
      rationale: [
        ...setupResult.rationale,
        `Setup 4 confirma: OI subiu +${oiResult.oiChange?.toFixed(2)}% — tendência fortalecida (+10 confiança)`,
      ],
    };
  }

  if (oiResult.oiStrength === "STRONG" && !sameDirection) {
    const penalized = Math.max(setupResult.confidence - 20, 0);
    return {
      ...setupResult,
      confidence: penalized,
      rationale: [
        ...setupResult.rationale,
        `⚠ Setup 4 CONTRA: OI subindo na direção oposta — tendência contrária (-20 confiança)`,
      ],
    };
  }

  if (oiResult.oiStrength === "WEAK") {
    const penalized = Math.max(setupResult.confidence - 15, 0);
    return {
      ...setupResult,
      confidence: penalized,
      rationale: [
        ...setupResult.rationale,
        `⚠ Setup 4 alerta: OI caindo ${oiResult.oiChange?.toFixed(2)}% — tendência enfraquecendo (-15 confiança)`,
      ],
    };
  }

  return setupResult;
}

// ── Swing High/Low Detection ───────────────────────────────────

function _findSwings(bars, lookback = 3) {
  const highs = [];
  const lows  = [];

  for (let i = lookback; i < bars.length - lookback; i++) {
    const isSwingHigh = bars.slice(i - lookback, i).every((b) => b.high <= bars[i].high) &&
                        bars.slice(i + 1, i + lookback + 1).every((b) => b.high <= bars[i].high);
    const isSwingLow  = bars.slice(i - lookback, i).every((b) => b.low >= bars[i].low) &&
                        bars.slice(i + 1, i + lookback + 1).every((b) => b.low >= bars[i].low);

    if (isSwingHigh) highs.push({ idx: i, price: bars[i].high });
    if (isSwingLow)  lows.push({ idx: i, price: bars[i].low });
  }

  return { highs, lows };
}

// ── Linear Trendline Fitting ───────────────────────────────────
// Fits a line through swing points using linear regression.
// Returns { slope, intercept, direction: "UP"|"DOWN", r2 } or null.

function _fitTrendline(points, totalBars) {
  if (points.length < 2) return null;

  // Use last 3 relevant swing points
  const pts = points.slice(-3);
  const n   = pts.length;
  const sumX  = pts.reduce((s, p) => s + p.idx, 0);
  const sumY  = pts.reduce((s, p) => s + p.price, 0);
  const sumXY = pts.reduce((s, p) => s + p.idx * p.price, 0);
  const sumX2 = pts.reduce((s, p) => s + p.idx * p.idx, 0);

  const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R² for quality check
  const meanY = sumY / n;
  const ss_tot = pts.reduce((s, p) => s + (p.price - meanY) ** 2, 0);
  const ss_res = pts.reduce((s, p) => s + (p.price - (slope * p.idx + intercept)) ** 2, 0);
  const r2 = ss_tot > 0 ? 1 - ss_res / ss_tot : 0;

  if (r2 < 0.7) return null; // poor fit — ignore this trendline

  return {
    slope,
    intercept,
    direction: slope > 0 ? "UP" : "DOWN",
    r2: parseFloat(r2.toFixed(3)),
  };
}

function _evalTrendlineAt(line, barIdx) {
  if (!line) return null;
  return line.slope * barIdx + line.intercept;
}

// ── Reversal Candle Detection ──────────────────────────────────

function _detectReversalCandle(bar, prevBar, direction) {
  if (!bar || !prevBar) return { found: false };

  const bodySize  = Math.abs(bar.close - bar.open);
  const totalSize = bar.high - bar.low;
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;

  if (direction === "LONG") {
    // Bullish engulfing
    if (bar.close > bar.open && bar.open < prevBar.close && bar.close > prevBar.open) {
      return { found: true, type: "Engulfing de alta" };
    }
    // Hammer (long lower wick, small body at top)
    if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.5) {
      return { found: true, type: "Martelo (hammer)" };
    }
    // Bullish pin bar (close near high)
    if (lowerWick > totalSize * 0.6 && bar.close > bar.open) {
      return { found: true, type: "Pin bar de alta" };
    }
  }

  if (direction === "SHORT") {
    // Bearish engulfing
    if (bar.close < bar.open && bar.open > prevBar.close && bar.close < prevBar.open) {
      return { found: true, type: "Engulfing de baixa" };
    }
    // Shooting star
    if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.5) {
      return { found: true, type: "Shooting star" };
    }
    // Bearish pin bar
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
