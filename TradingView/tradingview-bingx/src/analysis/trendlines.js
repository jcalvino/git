// ─────────────────────────────────────────────────────────────────
//  Trendlines Analysis Module
//
//  Detects LTA (Linha de Tendência de Alta, ascending support) and
//  LTB (Linha de Tendência de Baixa, descending resistance) from
//  raw OHLCV bars using N-bar pivots.
//
//  Design (aprovado 2026-04-23):
//    • Pivots = N-bar fractals (determinístico, igual TradingView).
//      N escala com o timeframe: M30=3, H1/H4=4, D=5.
//    • LTA    = reta pelos 2 pivot-lows mais recentes com slope > 0.
//    • LTB    = reta pelos 2 pivot-highs mais recentes com slope < 0.
//    • Toque  = low/high do candle dentro de 0.3 * ATR(14) da linha
//      E candle fecha do lado correto.
//    • Estados: valid | approaching | touching | broken | retesting.
//    • Sinais reconhecidos (para consumo futuro pelo signals.js):
//        - 3rd_touch_long / 3rd_touch_short
//        - break_retest_long / break_retest_short
//
//  O módulo é PURO: não depende de storage, config global ou signals.
//  Recebe symbol + adapter, retorna objeto serializável.
// ─────────────────────────────────────────────────────────────────

// ── Config por timeframe ──────────────────────────────────────────
const TF_CONFIG = {
  "15":  { N: 3, barCount: 300, atrPeriod: 14 },
  "30":  { N: 3, barCount: 300, atrPeriod: 14 },
  "60":  { N: 4, barCount: 300, atrPeriod: 14 },
  "240": { N: 4, barCount: 250, atrPeriod: 14 },  // H4 — default
  "D":   { N: 5, barCount: 200, atrPeriod: 14 },
  "W":   { N: 3, barCount: 100, atrPeriod: 14 },
};

// Tolerância adaptativa: bar toca a linha se distância ≤ TOUCH_ATR * ATR
const TOUCH_ATR       = 0.3;
// Preço está "aproximando" se distância ≤ APPROACH_ATR * ATR
const APPROACH_ATR    = 1.0;
// Janela (em barras) em que um break ainda qualifica para "break_retest"
const RETEST_WINDOW   = 10;

/**
 * Analisa trendlines de um símbolo em um timeframe específico.
 *
 * @param {string} symbol    — e.g. "BTCUSDC"
 * @param {object} adapter   — objeto { setSymbol, setTimeframe, getOhlcv, getQuote }
 * @param {object} opts      — { timeframe = "240" }
 * @returns {Promise<TrendlinesAnalysis>}
 */
export async function analyzeTrendlines(symbol, adapter, opts = {}) {
  const timeframe = opts.timeframe ?? "240";
  const cfg       = TF_CONFIG[timeframe];
  if (!cfg) {
    throw new Error(`[trendlines] Unsupported timeframe "${timeframe}". ` +
      `Supported: ${Object.keys(TF_CONFIG).join(", ")}`);
  }

  const { setSymbol, setTimeframe, getOhlcv, getQuote } = adapter;

  await setSymbol(symbol);
  await setTimeframe(timeframe);

  const [ohlcv, quote] = await Promise.all([
    getOhlcv({ count: cfg.barCount }),
    getQuote(),
  ]);

  const bars = (ohlcv.bars ?? []).filter((b) =>
    b &&
    Number.isFinite(b.time) &&
    Number.isFinite(b.high) &&
    Number.isFinite(b.low) &&
    Number.isFinite(b.close)
  );

  if (bars.length < 50) {
    return _emptyResult(symbol, timeframe, bars, quote);
  }

  const price = parseFloat(quote.last ?? quote.close ?? bars[bars.length - 1].close);
  const atr   = calcAtr(bars, cfg.atrPeriod);

  // ── Pivot detection (N-bar fractals) ───────────────────────────
  const { highs, lows } = findPivots(bars, cfg.N);

  // ── Trace LTA and LTB ──────────────────────────────────────────
  const lta = traceLta(lows, bars, atr);
  const ltb = traceLtb(highs, bars, atr);

  // ── Classify state + detect signals ────────────────────────────
  const ltaInfo = lta ? classifyLta(lta, bars, price, atr) : null;
  const ltbInfo = ltb ? classifyLtb(ltb, bars, price, atr) : null;

  return {
    symbol,
    timeframe,
    timestamp: new Date().toISOString(),
    price,
    atr,
    barCount: bars.length,
    config:   { N: cfg.N, touchAtr: TOUCH_ATR, approachAtr: APPROACH_ATR },

    pivots: {
      highs: highs.map((p) => ({ time: p.time, price: p.price })),
      lows:  lows.map((p)  => ({ time: p.time, price: p.price })),
    },

    lines: {
      lta: ltaInfo,
      ltb: ltbInfo,
    },

    // Bars serializados para renderização no dashboard (lightweight-charts)
    bars: bars.map((b) => ({
      time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
    })),
  };
}

// ═════════════════════════════════════════════════════════════════
// Pivot detection — N-bar fractals
// ═════════════════════════════════════════════════════════════════
/**
 * Um pivot de fundo (low pivot) é uma barra cujo `low` é estritamente
 * menor que as N barras à esquerda E às N barras à direita.
 * Pivot de topo (high pivot): simétrico para `high`.
 *
 * Nota: a janela à direita exige que tenhamos N barras futuras, então
 * os últimos N candles nunca são marcados como pivots — estão em zona
 * "sob observação" até o mercado avançar.
 */
function findPivots(bars, N) {
  const highs = [];
  const lows  = [];

  for (let i = N; i < bars.length - N; i++) {
    const bar = bars[i];
    let isHigh = true;
    let isLow  = true;

    for (let j = 1; j <= N; j++) {
      if (bars[i - j].high >= bar.high || bars[i + j].high >= bar.high) isHigh = false;
      if (bars[i - j].low  <= bar.low  || bars[i + j].low  <= bar.low)  isLow  = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) highs.push({ idx: i, time: bar.time, price: bar.high });
    if (isLow)  lows.push({  idx: i, time: bar.time, price: bar.low  });
  }

  return { highs, lows };
}

// ═════════════════════════════════════════════════════════════════
// Trendline tracing
// ═════════════════════════════════════════════════════════════════
/**
 * LTA = reta pelos 2 pivot-lows mais recentes com slope > 0
 * (segundo low mais recente é MAIOR que um low anterior).
 *
 * Estratégia: percorre lows do mais recente para o mais antigo, fixa o
 * mais recente como p2, e procura o primeiro p1 anterior com
 * p1.price < p2.price. Essa é a LTA "mais ativa" — a que liga o último
 * fundo ao fundo ascendente anterior mais próximo.
 */
function traceLta(lows, bars, atr) {
  if (lows.length < 2) return null;

  const p2 = lows[lows.length - 1];
  for (let i = lows.length - 2; i >= 0; i--) {
    const p1 = lows[i];
    if (p1.price < p2.price) {
      const slope     = (p2.price - p1.price) / (p2.idx - p1.idx);
      const intercept = p1.price - slope * p1.idx;
      return { type: "LTA", p1, p2, slope, intercept };
    }
  }
  return null;
}

/**
 * LTB = reta pelos 2 pivot-highs mais recentes com slope < 0.
 */
function traceLtb(highs, bars, atr) {
  if (highs.length < 2) return null;

  const p2 = highs[highs.length - 1];
  for (let i = highs.length - 2; i >= 0; i--) {
    const p1 = highs[i];
    if (p1.price > p2.price) {
      const slope     = (p2.price - p1.price) / (p2.idx - p1.idx);
      const intercept = p1.price - slope * p1.idx;
      return { type: "LTB", p1, p2, slope, intercept };
    }
  }
  return null;
}

// Valor da linha no índice da barra `i`
const lineAt = (line, i) => line.intercept + line.slope * i;

// ═════════════════════════════════════════════════════════════════
// State classification + signal detection
// ═════════════════════════════════════════════════════════════════
function classifyLta(line, bars, price, atr) {
  const touches = countTouches(line, bars, atr, "LTA");
  const broken  = detectBreak(line, bars, atr, "LTA");

  const nowIdx        = bars.length - 1;
  const priceAtLine   = lineAt(line, nowIdx);
  const distance      = price - priceAtLine;           // positivo = acima
  const distanceAbs   = Math.abs(distance);

  // Estado atual
  let state;
  const lastBar = bars[nowIdx];

  if (broken && broken.retested) {
    state = "retesting";
  } else if (broken) {
    state = "broken";
  } else if (distanceAbs <= TOUCH_ATR * atr) {
    state = "touching";
  } else if (distanceAbs <= APPROACH_ATR * atr) {
    state = "approaching";
  } else {
    state = "valid";
  }

  // Sinal: 3º toque ou mais, estado touching, candle atual de alta
  let signal = null;
  const bullishCandle = lastBar.close > lastBar.open;
  if (state === "touching" && touches.count >= 3 && bullishCandle && !broken) {
    signal = "3rd_touch_long";
  }
  // break_retest na LTA: LTA foi rompida (candle fechou abaixo) e agora retestou
  if (broken && broken.retested && lastBar.close < priceAtLine) {
    signal = "break_retest_short";
  }

  return _lineDto(line, bars, price, atr, state, signal, touches, broken);
}

function classifyLtb(line, bars, price, atr) {
  const touches = countTouches(line, bars, atr, "LTB");
  const broken  = detectBreak(line, bars, atr, "LTB");

  const nowIdx      = bars.length - 1;
  const priceAtLine = lineAt(line, nowIdx);
  const distance    = price - priceAtLine;             // negativo = abaixo
  const distanceAbs = Math.abs(distance);

  let state;
  const lastBar = bars[nowIdx];

  if (broken && broken.retested) {
    state = "retesting";
  } else if (broken) {
    state = "broken";
  } else if (distanceAbs <= TOUCH_ATR * atr) {
    state = "touching";
  } else if (distanceAbs <= APPROACH_ATR * atr) {
    state = "approaching";
  } else {
    state = "valid";
  }

  let signal = null;
  const bearishCandle = lastBar.close < lastBar.open;
  if (state === "touching" && touches.count >= 3 && bearishCandle && !broken) {
    signal = "3rd_touch_short";
  }
  if (broken && broken.retested && lastBar.close > priceAtLine) {
    signal = "break_retest_long";
  }

  return _lineDto(line, bars, price, atr, state, signal, touches, broken);
}

/**
 * Conta toques válidos na linha entre p1 e o fim dos bars.
 * Toque LTA: bar.low dentro de TOUCH_ATR*atr da linha E bar.close > linha.
 * Toque LTB: bar.high dentro de TOUCH_ATR*atr da linha E bar.close < linha.
 *
 * Inclui os pivots p1 e p2 na contagem (são toques por construção).
 */
function countTouches(line, bars, atr, type) {
  const tolerance = TOUCH_ATR * atr;
  const events = [];
  let lastTouchIdx = -Infinity;
  const MIN_GAP = 2; // bars entre toques para não contar o mesmo evento duas vezes

  for (let i = line.p1.idx; i < bars.length; i++) {
    const bar     = bars[i];
    const linePx  = lineAt(line, i);

    let isTouch = false;
    if (type === "LTA") {
      isTouch = Math.abs(bar.low - linePx) <= tolerance && bar.close > linePx - tolerance;
    } else {
      isTouch = Math.abs(bar.high - linePx) <= tolerance && bar.close < linePx + tolerance;
    }

    if (isTouch && i - lastTouchIdx >= MIN_GAP) {
      events.push({ idx: i, time: bar.time, price: type === "LTA" ? bar.low : bar.high });
      lastTouchIdx = i;
    }
  }

  return { count: events.length, events };
}

/**
 * Detecta rompimento + reteste.
 *
 * Para LTA: rompimento = candle fecha abaixo da linha menos tolerância.
 * Reteste  = após rompimento, preço voltou à linha dentro de RETEST_WINDOW
 *            barras e falhou em fechar acima dela (ou ainda está testando).
 * Para LTB: espelhado.
 */
function detectBreak(line, bars, atr, type) {
  const tolerance = TOUCH_ATR * atr;
  // Começa a checar a partir de p2 (break antes de p2 não faz sentido)
  for (let i = line.p2.idx + 1; i < bars.length; i++) {
    const bar    = bars[i];
    const linePx = lineAt(line, i);

    const brokenLta = type === "LTA" && bar.close < linePx - tolerance;
    const brokenLtb = type === "LTB" && bar.close > linePx + tolerance;

    if (brokenLta || brokenLtb) {
      // Procura reteste dentro da janela
      const windowEnd = Math.min(bars.length - 1, i + RETEST_WINDOW);
      for (let j = i + 1; j <= windowEnd; j++) {
        const b2   = bars[j];
        const lp2  = lineAt(line, j);
        const near = Math.abs(
          (type === "LTA" ? b2.high : b2.low) - lp2
        ) <= tolerance;
        if (near) {
          return { breakIdx: i, breakTime: bar.time, retested: true, retestIdx: j };
        }
      }
      return { breakIdx: i, breakTime: bar.time, retested: false };
    }
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════
// ATR (Average True Range) — Wilder smoothing
// ═════════════════════════════════════════════════════════════════
function calcAtr(bars, period = 14) {
  if (!bars || bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const cur  = bars[i];
    trs.push(Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev),
      Math.abs(cur.low  - prev)
    ));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

// ═════════════════════════════════════════════════════════════════
// DTO helpers
// ═════════════════════════════════════════════════════════════════
function _lineDto(line, bars, price, atr, state, signal, touches, broken) {
  const nowIdx      = bars.length - 1;
  const priceAtLine = lineAt(line, nowIdx);
  const distancePct = priceAtLine !== 0 ? (price - priceAtLine) / priceAtLine : 0;

  return {
    type:          line.type,
    p1:            { time: line.p1.time, price: line.p1.price },
    p2:            { time: line.p2.time, price: line.p2.price },
    slope:         line.slope,
    intercept:     line.intercept,
    priceAtNow:    priceAtLine,
    distance:      price - priceAtLine,
    distancePct,
    state,
    signal,
    touches:       touches.count,
    touchEvents:   touches.events,
    break:         broken,
    // Endpoints para desenhar no chart (rendering helper)
    drawPoints: [
      { time: bars[line.p1.idx].time,    price: line.p1.price },
      { time: bars[line.p2.idx].time,    price: line.p2.price },
      { time: bars[nowIdx].time,          price: priceAtLine    },
    ],
  };
}

function _emptyResult(symbol, timeframe, bars, quote) {
  const price = bars.length
    ? parseFloat(quote?.last ?? quote?.close ?? bars[bars.length - 1].close)
    : null;
  return {
    symbol,
    timeframe,
    timestamp: new Date().toISOString(),
    price,
    atr: null,
    barCount: bars.length,
    pivots: { highs: [], lows: [] },
    lines: { lta: null, ltb: null },
    bars: bars.map((b) => ({
      time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
    })),
    warning: "Insufficient bars for trendline analysis (need ≥50).",
  };
}

export const _internal = { findPivots, traceLta, traceLtb, countTouches, detectBreak, calcAtr, lineAt };
