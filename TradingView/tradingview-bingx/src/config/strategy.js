// ─────────────────────────────────────────────────────────────────
//  Strategy Parameters — BLANK SLATE
//
//  Estratégia resetada em 2026-04-23. Preencha os campos abaixo
//  conforme a nova direção de trading.
//
//  Schema preservado — importações continuam funcionando. Valores
//  iniciais são conservadores (desligados/mínimos) para evitar
//  execução acidental enquanto a estratégia está vazia.
// ─────────────────────────────────────────────────────────────────

export const STRATEGY = {
  // ── Assets disponíveis para scan (BingX USDC-M) ───────────────
  // Liste apenas os símbolos que você quer analisar. Vazio = bot
  // não escaneia nada (modo inerte, útil durante onboarding).
  // Formato: sem hífen (ex: "BTCUSDC", "ETHUSDC"). O bot converte
  // automaticamente para o formato BingX (BTC-USDC) ao enviar ordens.
  SYMBOLS: ["BTCUSDC", "ETHUSDC"],

  // ── Per-Symbol Config ─────────────────────────────────────────
  // enabled: true → símbolo entra no scan; false → ignorado.
  SYMBOL_CONFIG: {
    BTCUSDC: { enabled: true },
    ETHUSDC: { enabled: true },
  },

  // ── Per-Symbol SL Distance (override do SL_PCT) ──────────────
  // Ex: { BTCUSDC: 0.005 } = 0.5% para BTC. Fallback = STRATEGY.SL_PCT.
  SYMBOL_SL_PCT: {},

  // ── Per-Symbol Leverage Caps ─────────────────────────────────
  // Ex: { BTCUSDC: 10 } = max 10x em BTC. Fallback = 1x (sem alavancagem).
  SYMBOL_MAX_LEVERAGE: {},

  // ── Signal Expiry ─────────────────────────────────────────────
  // Sinais ficam stale se o preço andou muito desde a geração.
  SIGNAL_EXPIRY: {
    MAX_AGE_HOURS:  1,     // 1h até sinal expirar por idade
    ENTRY_MISS_PCT: 0.01,  // 1% de slippage aceitável desde entry
  },

  // ── Scale-In (entradas escalonadas) ──────────────────────────
  SCALE_IN: {
    ENABLED:     false,
    ENTRIES:     1,
    SPACING_PCT: 0.003,
  },

  // ═══════════════════════════════════════════════════════════════
  //  Controle de Risco — valores neutros (preencha conforme perfil)
  // ═══════════════════════════════════════════════════════════════

  // Limite de loss diário como fração do capital (0.005 = 0.5%)
  DAILY_RISK_PCT:   0.005,
  // Circuit breaker mensal (15% = pausa bot por drawdown)
  MONTHLY_RISK_PCT: 0.15,

  // Meta mensal mínima (USDT). 0 = sem meta; não pára bot.
  MONTHLY_PROFIT_FLOOR:   0,
  DAILY_PROFIT_TARGET:    0,
  DAILY_PROFIT_REFERENCE: 0,

  // ── Break-Even após TP1 (trade-runner mode) ──────────────────
  BREAK_EVEN: {
    ENABLED:         true,
    BUFFER_PCT:      0.0005,
    TRAIL_AFTER_TP2: true,
  },

  // ── Default SL (fallback quando não há SYMBOL_SL_PCT) ────────
  SL_PCT: 0.005,

  // ── Score mínimo de confiança para gerar sinal (0–100) ──────
  // 65 = alinhado com TRENDLINE_RETEST:
  //   • 3º toque (base 60) precisa de ≥1 modifier alinhado pra disparar
  //   • break_retest (base 75) dispara sozinho, modifiers ajustam margem
  MIN_SCORE: 65,

  // ── Reserva de capital: % sempre livre ───────────────────────
  MIN_FREE_CAPITAL_PCT: 0.20,

  // ── Capital alocado por slot de trade ────────────────────────
  CAPITAL_ALLOCATION_PCT: 0.20,

  // ═══════════════════════════════════════════════════════════════
  //  Take-Profit (Fibonacci R multiples)
  // ═══════════════════════════════════════════════════════════════
  // TP em R = múltiplos da distância entry→SL. Ex: TP1 = 1.5R.
  FIB_LEVELS: {
    TP1: 1.5,
    TP2: 2.618,
    TP3: 4.236,
  },

  // Fração da posição fechada em cada nível. Deve somar 1.0.
  TP_DISTRIBUTION: {
    TP1: 0.50,
    TP2: 0.30,
    TP3: 0.20,
  },

  // ── Technical thresholds (usados se a estratégia lê indicadores) ──
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

  // ── Timeframes ────────────────────────────────────────────────
  TIMEFRAMES: {
    ENTRY_ANALYSIS: "15",
    TREND_FILTER:   "60",
  },

  // ── Pesos do scoring (estrutura preservada para quando setups voltarem) ──
  SCORING_WEIGHTS: {},
};

// ═══════════════════════════════════════════════════════════════════
//  Named Trading Setups — VAZIO
//
//  Preencher cada setup com a forma:
//
//  MY_SETUP_ID: {
//    id:          string,
//    name:        string,
//    description: string,
//    leverage:    number,
//    sl_pct:      number,
//    tp_r:        { tp1: number, tp2: number, tp3: number },
//    enabled:     boolean,
//    symbols:     string[] | null,  // null = todos
//    direction:   "LONG" | "SHORT" | null,
//    filterOnly:  boolean,           // true = só confirma outros setups
//    // … parâmetros específicos do trigger
//  }
//
//  Veja skills/setup-detector/SKILL.md para exemplos.
// ═══════════════════════════════════════════════════════════════════

export const SETUPS = {
  TRENDLINE_RETEST: {
    id:          "TRENDLINE_RETEST",
    name:        "Retest de Trendline (Diária)",
    description: "3º toque ou break+retest na LTA/LTB diária, com SL estrutural (linha ± 0.8×ATR) e modificadores de EMA200/MACD/funding/fear-greed.",
    leverage:    3,
    // sl_pct NÃO é usado — o evaluator calcula sl_pct estrutural em runtime.
    // Mantemos um fallback caso os dados de trendline venham incompletos.
    sl_pct:      0.015,
    tp_r:        { tp1: 1.5, tp2: 2.618, tp3: 4.236 },
    enabled:     true,
    symbols:     ["BTCUSDC", "ETHUSDC"],
    direction:   null, // setup é bi-direcional (LONG ou SHORT conforme sinal)
    filterOnly:  false,
    timeframe:   "D",

    // Parâmetros específicos do setup
    params: {
      // Timeframes avaliados em ordem de prioridade (D > H4).
      // Se D disparar, usa D. Se D não disparar e H4 disparar, usa H4 com base menor.
      TIMEFRAMES: ["D", "240"],

      // Confiança base por timeframe + tipo de sinal
      BASE: {
        D:   { "3rd_touch": 60, "break_retest": 75 },   // primário
        "240": { "3rd_touch": 50, "break_retest": 65 }, // secundário: precisa de modifier a favor
      },

      // Distância do SL em múltiplos de ATR, abaixo/acima da linha de referência
      SL_ATR_MULT:        0.8,

      // Modificadores aditivos de confidence quando alinhados (contrários = simétricos)
      MOD_EMA200_DAILY:   10,
      MOD_MACD_WEEKLY:     8,
      MOD_ORDERBOOK:       7,
      MOD_FUNDING:         5,
      MOD_FEAR_GREED:      5,
    },
  },
};

export default STRATEGY;
