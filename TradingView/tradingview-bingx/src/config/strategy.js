// ─────────────────────────────────────────────────────────────────
//  Strategy Parameters — Professional Edition (v2)
//
//  Filosofia (trader institucional, 30+ anos):
//    1. "Primeiro preserve o capital, depois maximize o retorno."
//       — Daily risk baixado de 1.0% para 0.5%. Em $128 = $0.64/dia max.
//    2. "Trade-runner mode": fecha 50% no TP1 e move SL para break-even.
//       Trade restante fica livre de risco — capital garantido + upside.
//    3. Menos é mais. 8 ativos de altíssima liquidez (no lugar de 33).
//       Para $128 de capital, cobertura excessiva gera noise.
//    4. Meta mensal: mínimo $100 (piso, não teto). Bot continua operando
//       mesmo após atingir — esse é o 'bonus'.
//
//  Todos os constantes de trading vivem aqui. Editar para ajustar.
// ─────────────────────────────────────────────────────────────────

export const STRATEGY = {
  // ── Assets (BingX USDT-M Perpetual Futures symbols) ───────────
  // NCC* = BingX non-crypto contracts (commodities, FX, stocks)
  // NCCO = commodities | NCFX = forex | NCSK = stocks
  SYMBOLS: [
    // Tier 1 — highest liquidity crypto
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    // Tier 2 — established alts
    "ADAUSDT", "LINKUSDT", "NEARUSDT", "UNIUSDT", "AAVEUSDT",
    // Tier 3 — newer / higher volatility
    "TRXUSDT", "SUIUSDT", "ONDOUSDT", "ENAUSDT", "HYPEUSDT",
    // Commodities — precious metals
    "NCCOGOLD2USD-USDT",        // Gold (XAU)
    "NCCOXAG2USD-USDT",         // Silver (XAG)
    "NCCOXPT2USD-USDT",         // Platinum (XPT)
    // Commodities — energy (7*24 = around-the-clock perpetuals)
    "NCCO7241OILBRENT2USD-USDT", // Oil Brent 7*24
    "NCCO7241OILWTI2USD-USDT",   // Oil WTI 7*24
    "NCCO7241NATGAS2USD-USDT",   // Natural Gas 7*24
    "NCCOGASOLINE2USD-USDT",     // Gasoline (RBOB)
    // Commodities — agriculture
    "NCCOSOYBEANS2USD-USDT",    // Soybeans
    "NCCOWHEAT2USD-USDT",       // Wheat
    "NCCOCOCOA2USD-USDT",       // Cocoa
    // Commodities — metals
    "NCCOCOPPER2USD-USDT",      // Copper
    "NCCOALUMINIUM2USD-USDT",   // Aluminium
    // Forex
    "NCFXEUR2USD-USDT",         // EUR/USD
    // Stocks (CFD)
    "NCSKTSLA2USD-USDT",        // Tesla
    "NCSKNVDA2USD-USDT",        // NVIDIA
    "NCSKGOOGL2USD-USDT",       // Google
    "NCSKAMZN2USD-USDT",        // Amazon
    "NCSKMSFT2USD-USDT",        // Microsoft
  ],

  // ── Per-Symbol Config ──────────────────────────────────────────
  // ⚠ PORTFOLIO CURATADO (2026-04-22): para $128 de capital, apenas
  //   8 ativos ficam ATIVOS. Os outros permanecem configurados (para
  //   quando o capital crescer) mas com enabled: false.
  //   Critério: top-5 cripto de maior liquidez + 3 commodities clássicas
  //   (Gold, Silver, Oil WTI) que compensam dias de choppiness em cripto.
  SYMBOL_CONFIG: {
    // ── ATIVOS (8) ────────────────────────────────────────────
    BTCUSDT:                      { enabled: true,  tier: "primary"    },
    ETHUSDT:                      { enabled: true,  tier: "primary"    },
    SOLUSDT:                      { enabled: true,  tier: "primary"    },
    BNBUSDT:                      { enabled: true,  tier: "primary"    },
    XRPUSDT:                      { enabled: true,  tier: "primary"    },
    "NCCOGOLD2USD-USDT":          { enabled: true,  tier: "commodity"  }, // hedge macro
    "NCCOXAG2USD-USDT":           { enabled: true,  tier: "commodity"  },
    "NCCO7241OILWTI2USD-USDT":    { enabled: true,  tier: "commodity"  },
    // ── DESABILITADOS (aguardando crescimento de capital) ────
    ADAUSDT:                      { enabled: false, tier: "secondary" },
    LINKUSDT:                     { enabled: false, tier: "secondary" },
    NEARUSDT:                     { enabled: false, tier: "secondary" },
    UNIUSDT:                      { enabled: false, tier: "secondary" },
    AAVEUSDT:                     { enabled: false, tier: "secondary" },
    TRXUSDT:                      { enabled: false, tier: "secondary" },
    SUIUSDT:                      { enabled: false, tier: "secondary" },
    ONDOUSDT:                     { enabled: false, tier: "secondary" },
    ENAUSDT:                      { enabled: false, tier: "secondary" },
    HYPEUSDT:                     { enabled: false, tier: "secondary" },
    "NCCOXPT2USD-USDT":           { enabled: false, tier: "commodity"  },
    "NCCO7241OILBRENT2USD-USDT":  { enabled: false, tier: "commodity"  },
    "NCCO7241NATGAS2USD-USDT":    { enabled: false, tier: "commodity"  },
    "NCCOGASOLINE2USD-USDT":      { enabled: false, tier: "commodity"  },
    "NCCOSOYBEANS2USD-USDT":      { enabled: false, tier: "commodity"  },
    "NCCOWHEAT2USD-USDT":         { enabled: false, tier: "commodity"  },
    "NCCOCOCOA2USD-USDT":         { enabled: false, tier: "commodity"  },
    "NCCOCOPPER2USD-USDT":        { enabled: false, tier: "commodity"  },
    "NCCOALUMINIUM2USD-USDT":     { enabled: false, tier: "commodity"  },
    "NCFXEUR2USD-USDT":           { enabled: false, tier: "fx"         },
    "NCSKTSLA2USD-USDT":          { enabled: false, tier: "stock"      },
    "NCSKNVDA2USD-USDT":          { enabled: false, tier: "stock"      },
    "NCSKGOOGL2USD-USDT":         { enabled: false, tier: "stock"      },
    "NCSKAMZN2USD-USDT":          { enabled: false, tier: "stock"      },
    "NCSKMSFT2USD-USDT":          { enabled: false, tier: "stock"      },
  },

  // ── Per-Symbol SL Distance (15-min Day Trading) ───────────────
  // SL apertado = fewer, bigger winners. ATR-calibrated por ativo.
  // Se símbolo não listado, STRATEGY.SL_PCT (0.5%) é usado como fallback.
  SYMBOL_SL_PCT: {
    // Crypto — Tier 1 (apertados — liquidez permite stops precisos)
    BTCUSDT:  0.005, // 0.5%
    ETHUSDT:  0.006, // 0.6%
    SOLUSDT:  0.008, // 0.8%
    BNBUSDT:  0.006, // 0.6%
    XRPUSDT:  0.008, // 0.8%
    // Crypto — Tier 2
    ADAUSDT:  0.008,
    LINKUSDT: 0.008,
    NEARUSDT: 0.010,
    UNIUSDT:  0.008,
    AAVEUSDT: 0.008,
    // Crypto — Tier 3
    TRXUSDT:  0.008,
    SUIUSDT:  0.010,
    ONDOUSDT: 0.012,
    ENAUSDT:  0.010,
    HYPEUSDT: 0.012,
    // Commodities — precious metals
    "NCCOGOLD2USD-USDT":         0.008, // Gold: ATR moderado
    "NCCOXAG2USD-USDT":          0.010, // Silver: mais volátil que gold
    "NCCOXPT2USD-USDT":          0.010,
    // Commodities — energy (wider — news & inventory spikes)
    "NCCO7241OILBRENT2USD-USDT": 0.012,
    "NCCO7241OILWTI2USD-USDT":   0.012,
    "NCCO7241NATGAS2USD-USDT":   0.015, // Natural Gas: swings extremos
    "NCCOGASOLINE2USD-USDT":     0.012,
    // Commodities — agriculture
    "NCCOSOYBEANS2USD-USDT":     0.012,
    "NCCOWHEAT2USD-USDT":        0.012,
    "NCCOCOCOA2USD-USDT":        0.015,
    // Commodities — metals
    "NCCOCOPPER2USD-USDT":       0.010,
    "NCCOALUMINIUM2USD-USDT":    0.010,
    // Forex
    "NCFXEUR2USD-USDT":          0.005,
    // Stocks
    "NCSKTSLA2USD-USDT":         0.015,
    "NCSKNVDA2USD-USDT":         0.012,
    "NCSKGOOGL2USD-USDT":        0.010,
    "NCSKAMZN2USD-USDT":         0.010,
    "NCSKMSFT2USD-USDT":         0.008,
  },

  // ── Per-Symbol Leverage Caps ───────────────────────────────────
  // Rule: high leverage OK apenas em Tier 1 onde stop pode ser justo.
  // Com SL de 0.5% a 30x, loss per trade ainda cai via position sizing.
  SYMBOL_MAX_LEVERAGE: {
    BTCUSDT:  30, ETHUSDT: 10, SOLUSDT: 20, BNBUSDT: 20, XRPUSDT: 20,
    ADAUSDT:  15, LINKUSDT: 15, NEARUSDT: 10, UNIUSDT: 10, AAVEUSDT: 10,
    TRXUSDT:  15, SUIUSDT: 10, ONDOUSDT:  5, ENAUSDT: 10, HYPEUSDT: 10,
    "NCCOGOLD2USD-USDT":         10,
    "NCCOXAG2USD-USDT":          10,
    "NCCOXPT2USD-USDT":           5,
    "NCCO7241OILBRENT2USD-USDT":  5,
    "NCCO7241OILWTI2USD-USDT":    5,
    "NCCO7241NATGAS2USD-USDT":    3,
    "NCCOGASOLINE2USD-USDT":      5,
    "NCCOSOYBEANS2USD-USDT":      5,
    "NCCOWHEAT2USD-USDT":         5,
    "NCCOCOCOA2USD-USDT":         3,
    "NCCOCOPPER2USD-USDT":        5,
    "NCCOALUMINIUM2USD-USDT":     5,
    "NCFXEUR2USD-USDT":          20,
    "NCSKTSLA2USD-USDT":          5,
    "NCSKNVDA2USD-USDT":          5,
    "NCSKGOOGL2USD-USDT":         5,
    "NCSKAMZN2USD-USDT":          5,
    "NCSKMSFT2USD-USDT":          5,
  },

  // ── Signal Expiry ──────────────────────────────────────────────
  // No 15-min, sinais ficam stale rapidamente.
  SIGNAL_EXPIRY: {
    MAX_AGE_HOURS:  0.5,  // 30 min
    ENTRY_MISS_PCT: 0.01, // 1% além do entry[0]
  },

  // ── Scale-In ───────────────────────────────────────────────────
  // Desabilitado (single entry) — economiza 2/3 das fees de abertura
  // e elimina complexidade na gestão de múltiplos SLs.
  SCALE_IN: {
    ENABLED:     false,
    ENTRIES:     1,
    SPACING_PCT: 0.003,
  },

  // ═══════════════════════════════════════════════════════════════
  //  ⚡ CONTROLE DE RISCO RIGOROSO (v2 — trader institucional)
  // ═══════════════════════════════════════════════════════════════

  // ── Daily Loss Limit ──────────────────────────────────────────
  // ⚠ REDUZIDO de 1.0% para 0.5% — controle mais rigoroso.
  //   Em $128 de capital = $0.64/dia máximo de perda.
  //   Em $200                 = $1.00/dia máximo de perda.
  //   Bot pausa trades até o próximo dia UTC quando atingido.
  DAILY_RISK_PCT:   0.005,  // 0.5%
  MONTHLY_RISK_PCT: 0.15,   // 15% — informacional, circuit breaker mensal

  // ── Monthly Profit Floor ──────────────────────────────────────
  // Meta MÍNIMA mensal: $100. Bot NÃO PARA quando atinge.
  // Serve para:
  //   - Exibir progresso no dashboard (barra + anel)
  //   - Alertar quando ficando atrás do pace esperado
  //   - Histórico: meses que cumpriram vs não cumpriram
  MONTHLY_PROFIT_FLOOR: 100,

  // ── Daily Profit Reference ────────────────────────────────────
  // $100/30 dias úteis ≈ $3.33/dia para cumprir o piso mensal.
  // Usado no dashboard para calcular 'pace' (em linha vs atrás).
  DAILY_PROFIT_TARGET:    0,   // 0 = sem parada automática por lucro
  DAILY_PROFIT_REFERENCE: 3.33, // pace diário para cumprir $100/mês

  // ── Break-Even após TP1 (Trade-Runner Mode) ───────────────────
  // Ao atingir TP1 (fechando primeiro lote), move SL para entry + buffer.
  // Trade restante fica "grátis" — capital protegido, upside preservado.
  // Esse mecanismo é o que permite deixar winners correrem até TP3.
  BREAK_EVEN: {
    ENABLED:           true,
    BUFFER_PCT:        0.0005, // 0.05% além do entry (cobre fees ~0.04% round-trip)
    TRAIL_AFTER_TP2:   true,   // Após TP2, move SL para meio caminho entry→TP2
  },

  // ── Risk — Default SL (fallback quando não há override por símbolo) ──
  SL_PCT: 0.005,

  // ── Minimum Confidence Score ──────────────────────────────────
  // ⚠ AUMENTADO de 75 para 78 — mais seletivo.
  //   Menos trades, mais qualidade = melhor sharpe.
  MIN_SCORE: 78,

  // ── Capital Reserve ────────────────────────────────────────────
  // Sempre manter esta % do capital total livre.
  // Garante que uma oportunidade nunca é perdida por capital esgotado.
  MIN_FREE_CAPITAL_PCT: 0.20,

  // ── Per-Trade Allocation ───────────────────────────────────────
  // Capital alocado por slot de trade. Limita valor da posição (não count).
  // 20% × $128 = $25.60 por trade.
  CAPITAL_ALLOCATION_PCT: 0.20,

  // ═══════════════════════════════════════════════════════════════
  //  🎯 TAKE-PROFIT PROFESSIONAL DISTRIBUTION
  // ═══════════════════════════════════════════════════════════════

  // ── Fibonacci Take-Profit Levels (em R multiples) ─────────────
  // TP1 @ 1.5R garante que APÓS fees (~0.08%), o trade tem R:R ≥ 1.4.
  // Sobre avg entry com SL 0.5%:
  //   TP1 @ 1.5R  = +0.75% (lucro rápido; fecha 50%)
  //   TP2 @ 2.618R = +1.31% (meio do trade; fecha 30%)
  //   TP3 @ 4.236R = +2.12% (runner; 20% final)
  FIB_LEVELS: {
    TP1: 1.5,   // Reduzido de 1.618 para 1.5 — garante saída rápida
    TP2: 2.618,
    TP3: 4.236,
  },

  // ── TP Distribution (redistribuído para "garantir o lucro cedo") ──
  // Antes: 40 / 35 / 25. Agora: 50 / 30 / 20.
  // Racional: fechar 50% no TP1 + BE stop no restante = impossível
  // terminar o trade negativo (exceto gap > 0.05%). Combinação essencial
  // para cumprir piso mensal com win rate moderado (~45-55%).
  TP_DISTRIBUTION: {
    TP1: 0.50,  // 50% fechado → trava o lucro
    TP2: 0.30,  // 30% fechado → reforça
    TP3: 0.20,  // 20% runner  → bonus
  },

  // ── Technical Analysis Thresholds ─────────────────────────────
  RSI: {
    OVERBOUGHT:   70,
    OVERSOLD:     30,
    NEUTRAL_HIGH: 60,
    NEUTRAL_LOW:  40,
  },

  ORDERBOOK: {
    BULL_IMBALANCE: 0.55,
    BEAR_IMBALANCE: 0.45,
    DEPTH_LEVELS:   20,
  },

  FUNDING: {
    BEARISH_THRESHOLD:  0.0001,
    BULLISH_THRESHOLD: -0.0001,
  },

  FEAR_GREED: {
    EXTREME_FEAR_MAX:   25,
    FEAR_MAX:           45,
    GREED_MIN:          55,
    EXTREME_GREED_MIN:  75,
  },

  // ── Timeframes ─────────────────────────────────────────────────
  TIMEFRAMES: {
    ENTRY_ANALYSIS: "15",  // 15-minute bars
    TREND_FILTER:   "60",  // 1-hour bars para trend direction
  },

  // ── Legacy Scoring Weights (kept for reference) ────────────────
  SCORING_WEIGHTS: {
    EMA200_DAILY:     15,
    EMA21_WEEKLY:     10,
    MACD_WEEKLY:      10,
    RSI_WEEKLY:        5,
    FUNDING_RATE:     15,
    ORDERBOOK:        10,
    LONG_SHORT_RATIO: 10,
    FEAR_GREED:       10,
    MACRO_CONTEXT:    15,
  },
};

// ═══════════════════════════════════════════════════════════════════
//  🎯 Named Trading Setups
// ═══════════════════════════════════════════════════════════════════
// Cada setup tem lógica de trigger, leverage e SL próprios.
// A engine avalia todos em paralelo e escolhe o de maior confiança.
//
// filterOnly: true  → usado como confirmação para outros setups
// symbols: string[] → restringe a ativos específicos (ex: BTC-only)
//
// ⚠ Todos os tp_r.tp1 DEVEM ser ≥ 1.5R para cumprir a regra:
//   "nunca entrar em trade onde TP1 < 1.5R (após fees)"

export const SETUPS = {

  // ── Setup 1 ─ EMA Pullback Continuation (15min + 1H) ──────────
  // O setup de maior probabilidade em mercados em tendência.
  //
  // Logic:
  //   1. 1H EMA stack: EMA9 > EMA21 > EMA50 (bull) ou inverse (bear)
  //   2. 15min: preço no pullback ao EMA21 (dentro de ema_touch_pct)
  //   3. 15min: reversal candle confirma rejeição
  //   4. 1H RSI fora de extremos (>75 ou <25) — evita fade
  //   5. Weekly bias (RSI/MACD/StochRSI) como bônus/penalidade
  //
  // Why it works: em mercados em tendência, preço sempre volta ao EMA21
  // antes de continuar. É onde institucionais posicionam ordens.
  EMA_PULLBACK: {
    id: "EMA_PULLBACK",
    name: "Setup 1 — EMA Pullback na Tendência (15min + 1H)",
    description:
      "EMA9/21/50 stack no 1H define tendência; toque no EMA21 no 15min + vela de reversão = entrada",
    leverage: 3,       // reduzido de 5x — limita max loss
    sl_pct: 0.005,     // usa SYMBOL_SL_PCT override por ativo
    tp_r: { tp1: 1.5, tp2: 2.618, tp3: 4.236 },
    enabled: true,
    symbols: null,
    ema_touch_pct: 0.008,
  },

  // ── Setup 2 ─ STH Realized Price SHORT (Isolated) ─────────────
  // Setup ISOLADO — ignora tendência geral, apenas BTC, apenas SHORT.
  //
  // ⚠ Risk: 20x leverage + 10% SL. Sizing usa regra de 0.5% capital risk,
  //   então dollar loss = 0.5% × capital independente da alavancagem.
  STH_REALIZED_PRICE: {
    id: "STH_REALIZED_PRICE",
    name: "Setup 2 — STH Realized Price SHORT",
    description:
      "BTC aproximando da STH Realized Price (linha amarela bitcoinmagazinepro.com) → SHORT 20x, SL 10%",
    leverage: 20,
    sl_pct: 0.10,
    tp_r: { tp1: 1.5, tp2: 2.5, tp3: 4.0 },
    enabled: true,
    symbols: ["BTCUSDT"],
    direction: "SHORT",
    touch_pct: 0.03,
    converge_threshold_pct: 2,
  },

  // ── Setup 3 ─ S/R Breakout + Retest (1H levels + 15min entry) ──
  // Identifica S/R horizontal do 1H, aguarda breakout + retest no 15min.
  //
  // Why it works: "level flip" é onde traders presos são squeezed e
  // institucionais adicionam novas posições. Maior volume de entrada.
  SR_BREAKOUT_RETEST: {
    id: "SR_BREAKOUT_RETEST",
    name: "Setup 3 — Rompimento + Reteste de S/R (1H + 15min)",
    description:
      "Nível-chave do 1H rompido com fechamento + reteste no 15min = entrada na virada de S/R",
    leverage: 3,
    sl_pct: 0.007,
    tp_r: { tp1: 1.618, tp2: 2.618, tp3: 4.236 },
    enabled: true,
    symbols: null,
    retest_tolerance_pct: 0.015,
    min_touches: 2,
  },

  // ── Setup 4 ─ Open Interest Confirmation Filter ───────────────
  // OI subindo = trend fortalece (confirma). OI caindo = enfraquece.
  // Primariamente filtro para outros setups; pode gerar sinal standalone.
  OI_CONFIRMATION: {
    id: "OI_CONFIRMATION",
    name: "Setup 4 — Open Interest como Filtro",
    description:
      "OI subindo = tendência fortalece (confirma setup); OI caindo = tendência enfraquece (cancela setup)",
    leverage: 3,
    sl_pct: 0.012,     // reduzido de 0.015 — controle mais rigoroso
    tp_r: { tp1: 1.8, tp2: 3.5, tp3: 5.5 },
    enabled: true,
    symbols: ["BTCUSDT", "ETHUSDT"],
    filterOnly: true,
    oi_change_threshold: 3,
  },

  // ── Setup 5 ─ Liquidation Zone Accumulation (24h) ─────────────
  // Quando cluster grande de liquidações se acumula em uma zona,
  // mercado tende a empurrar para triggerar cascata.
  LIQUIDATION_ZONE: {
    id: "LIQUIDATION_ZONE",
    name: "Setup 5 — Mapa de Liquidações BTC (24h)",
    description:
      "Acúmulo alto em zona após limpar liquidações opostas → sinal de liquidação em cascata",
    leverage: 5,
    sl_pct: 0.015,     // reduzido de 0.02 — controle mais rigoroso
    tp_r: { tp1: 1.8, tp2: 3.0, tp3: 5.0 },
    enabled: true,
    symbols: ["BTCUSDT"],
    zone_dominance_threshold: 0.65,
  },
};

export default STRATEGY;
