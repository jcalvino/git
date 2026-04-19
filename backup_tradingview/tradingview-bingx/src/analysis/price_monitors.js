// ─────────────────────────────────────────────────────────────────
//  Price Level Monitors — Multi-Stage State Machine
//
//  Evaluates user-defined price level conditions every scanner cycle.
//  When all stages of a monitor complete, a trade signal is generated
//  and executed automatically (same as scanner-generated signals).
//
//  Monitor types:
//
//  TOUCH_WEAKNESS_ENTRY
//    Stage 1: Price touches the touch_level (bar.high >= level)
//    Stage 2: Next candle shows weakness (bearish close or wick rejection)
//    Stage 3: Price reaches entry_level → fire signal
//    Example: ETH touches 2560 → bearish candle → SHORT at 2500
//
//  BREAKOUT_RETEST
//    Stage 1: Price closes above/below level (clean breakout)
//    Stage 2: Price pulls back into retest zone (within tolerance)
//    Stage 3: Bar closes back on the breakout side (level holds) → fire signal
//    Example: ETH closes above 2560 → retests 2560 → holds → LONG at market
//
//  Config:  monitors.json (project root)
//  State:   data/monitors_state.json (auto-persisted between restarts)
// ─────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import config from "../config/index.js";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, "../..");
const MON_PATH   = resolve(ROOT, "monitors.json");
const STATE_PATH = resolve(ROOT, "data/monitors_state.json");

// ── State I/O ──────────────────────────────────────────────────

function loadState() {
  try {
    if (!existsSync(STATE_PATH)) return {};
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    const dir = resolve(ROOT, "data");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch { /* non-critical — in-memory state still works */ }
}

// ── Monitor Config ─────────────────────────────────────────────

function loadMonitors() {
  try {
    if (!existsSync(MON_PATH)) return [];
    return JSON.parse(readFileSync(MON_PATH, "utf8")).monitors ?? [];
  } catch {
    return [];
  }
}

// ── Main Entry Point ───────────────────────────────────────────

/**
 * Evaluate all price monitors for the given symbol.
 * Called once per symbol per scan cycle from scanner.js.
 *
 * @param {string} symbol          — e.g. "ETHUSDT"
 * @param {object} technical       — from analyzeTechnical(); provides .price and .daily.bars
 * @param {number} capitalUsdt     — current capital for position sizing
 * @returns {Array} triggered signals ready to be saved + executed
 */
export function checkPriceMonitors(symbol, technical, capitalUsdt) {
  const monitors = loadMonitors().filter(
    (m) => m.enabled && m.symbol === symbol
  );
  if (!monitors.length) return [];

  const state   = loadState();
  const signals = [];

  const price  = technical.price;
  const bars   = technical.daily?.bars ?? []; // 15min bars (last 60)

  if (!price || bars.length < 3) return [];

  for (const monitor of monitors) {
    const monState = state[monitor.id] ?? { stage: "watching", stageData: {} };

    // Skip expired monitors
    if (_isExpired(monState, monitor.expiry_hours)) {
      console.log(`  [MONITOR] ${monitor.id}: expirado após ${monitor.expiry_hours}h — resetando`);
      state[monitor.id] = { stage: "watching", stageData: {}, resetAt: new Date().toISOString() };
      continue;
    }

    // Skip already triggered
    if (monState.stage === "triggered") continue;

    let result;
    if (monitor.type === "TOUCH_WEAKNESS_ENTRY") {
      result = _evalTouchWeaknessEntry(monitor, monState, bars, price, capitalUsdt);
    } else if (monitor.type === "BREAKOUT_RETEST") {
      result = _evalBreakoutRetest(monitor, monState, bars, price, capitalUsdt);
    } else {
      console.warn(`  [MONITOR] Unknown type "${monitor.type}" for ${monitor.id}`);
      continue;
    }

    state[monitor.id] = result.newState;

    const stageLabel = result.newState.stage;
    const prevStage  = monState.stage;
    if (stageLabel !== prevStage) {
      console.log(`  [MONITOR] ${monitor.id}: ${prevStage} → ${stageLabel}`);
    } else {
      console.log(`  [MONITOR] ${monitor.id}: [${stageLabel}] ${result.rationale?.slice(-1)?.[0] ?? ""}`);
    }

    if (result.signal) {
      console.log(`  [MONITOR] *** TRIGGERED: ${monitor.id} → ${result.signal.direction} ${symbol}`);
      signals.push(result.signal);
    }
  }

  saveState(state);
  return signals;
}

/**
 * Return a summary of all monitors and their current stage.
 * Used by the API for dashboard display.
 */
export function getMonitorStatus() {
  const monitors = loadMonitors();
  const state    = loadState();

  return monitors.map((m) => {
    const s = state[m.id] ?? { stage: "watching", stageData: {} };
    return {
      id:          m.id,
      symbol:      m.symbol,
      name:        m.name,
      type:        m.type,
      direction:   m.direction,
      enabled:     m.enabled,
      stage:       s.stage,
      stageData:   s.stageData,
      touchedAt:   s.touchedAt   ?? null,
      brokeAt:     s.brokeAt     ?? null,
      retestingAt: s.retestingAt ?? null,
      triggeredAt: s.triggeredAt ?? null,
      resetAt:     s.resetAt     ?? null,
      levels:      _getMonitorLevels(m),
    };
  });
}

function _getMonitorLevels(m) {
  if (m.type === "TOUCH_WEAKNESS_ENTRY") {
    return { touch: m.touch_level, entry: m.entry_level, reset: m.reset_above };
  }
  if (m.type === "BREAKOUT_RETEST") {
    return { breakout: m.level, tp: m.tp_fixed, reset: m.reset_below };
  }
  return {};
}

// ── Type 1: TOUCH_WEAKNESS_ENTRY ───────────────────────────────
// Stage machine: watching → touched → weakness_seen → triggered

function _evalTouchWeaknessEntry(monitor, state, bars, price, capitalUsdt) {
  const touchLevel  = monitor.touch_level;
  const entryLevel  = monitor.entry_level;
  const resetAbove  = monitor.reset_above ?? touchLevel * 1.05;

  let stage     = state.stage     ?? "watching";
  let stageData = state.stageData ?? {};
  const lastBar = bars[bars.length - 1];
  const rationale = [];

  // ── Global reset: price rose too far above the touch level ────
  if (price >= resetAbove && stage !== "watching") {
    return {
      newState: { stage: "watching", stageData: {}, resetAt: new Date().toISOString() },
      signal:   null,
      rationale: [`Reset: preço $${price.toFixed(0)} acima do reset level $${resetAbove}`],
    };
  }

  // ──────────────────────────────────────────────────────────────
  if (stage === "watching") {
    // Look for a touch in the last 5 bars
    const recent = bars.slice(-5);
    const touchBar = recent.slice().reverse().find((b) => b.high >= touchLevel);

    if (!touchBar) {
      return {
        newState: state,
        signal:   null,
        rationale: [`Watching: aguardando toque em $${touchLevel} (máx recente: $${Math.max(...recent.map(b => b.high)).toFixed(0)})`],
      };
    }

    rationale.push(`Toque em $${touchLevel} detectado (high: $${touchBar.high.toFixed(0)})`);

    // Find bars after the touch bar
    const touchIdx    = bars.lastIndexOf(touchBar);
    const postBars    = bars.slice(touchIdx + 1);
    const weakness    = _detectWeakness(touchBar, postBars);

    if (weakness.found) {
      rationale.push(`Fraqueza imediata: ${weakness.reason}`);

      // Already reached entry level?
      if (price <= entryLevel || lastBar.low <= entryLevel) {
        const entryPrice = Math.min(price, entryLevel);
        rationale.push(`Preço já atingiu o nível de entrada $${entryLevel} → SHORT ativado`);
        return {
          newState: { stage: "triggered", stageData, triggeredAt: new Date().toISOString() },
          signal:   _buildSignal(monitor, entryLevel, rationale, capitalUsdt),
          rationale,
        };
      }

      return {
        newState: { stage: "weakness_seen", stageData: { touchBarTime: touchBar.time }, touchedAt: new Date().toISOString(), weaknessAt: new Date().toISOString() },
        signal:   null,
        rationale: [...rationale, `Fraqueza confirmada — aguardando queda até $${entryLevel}`],
      };
    }

    // Touch found but no weakness yet
    return {
      newState: { stage: "touched", stageData: { touchBarTime: touchBar.time }, touchedAt: new Date().toISOString() },
      signal:   null,
      rationale: [...rationale, `Aguardando próxima vela de 15min para confirmar perda de força`],
    };
  }

  // ──────────────────────────────────────────────────────────────
  if (stage === "touched") {
    rationale.push(`Nível $${touchLevel} tocado — verificando fraqueza pós-toque`);

    const touchBarTime = stageData.touchBarTime;
    // Find the touch bar and all bars after it
    const touchIdx = touchBarTime
      ? bars.findIndex((b) => b.time >= touchBarTime)
      : bars.length - 3;
    const touchBar  = touchIdx >= 0 ? bars[touchIdx] : null;
    const postBars  = touchIdx >= 0 ? bars.slice(touchIdx + 1) : [];

    if (!postBars.length) {
      return {
        newState: state,
        signal:   null,
        rationale: [...rationale, `Aguardando nova vela de 15min após o toque`],
      };
    }

    const weakness = _detectWeakness(touchBar, postBars);

    if (!weakness.found) {
      return {
        newState: state,
        signal:   null,
        rationale: [...rationale, `${postBars.length} vela(s) pós-toque sem confirmar fraqueza — ainda aguardando`],
      };
    }

    rationale.push(`Fraqueza confirmada: ${weakness.reason}`);

    // Already at entry level?
    if (price <= entryLevel || lastBar.low <= entryLevel) {
      rationale.push(`Preço já em $${price.toFixed(0)} → atingiu nível de entrada $${entryLevel} → SHORT`);
      return {
        newState: { stage: "triggered", stageData, triggeredAt: new Date().toISOString() },
        signal:   _buildSignal(monitor, entryLevel, rationale, capitalUsdt),
        rationale,
      };
    }

    return {
      newState: { stage: "weakness_seen", stageData, weaknessAt: new Date().toISOString() },
      signal:   null,
      rationale: [...rationale, `Aguardando queda até $${entryLevel} para entrada SHORT`],
    };
  }

  // ──────────────────────────────────────────────────────────────
  if (stage === "weakness_seen") {
    rationale.push(`Fraqueza em $${touchLevel} confirmada — acompanhando queda`);
    rationale.push(`Preço atual: $${price.toFixed(0)} | Alvo de entrada: $${entryLevel}`);

    if (price <= entryLevel || lastBar.low <= entryLevel) {
      rationale.push(`ENTRADA ATIVADA: preço atingiu $${entryLevel}`);
      return {
        newState: { stage: "triggered", stageData, triggeredAt: new Date().toISOString() },
        signal:   _buildSignal(monitor, entryLevel, rationale, capitalUsdt),
        rationale,
      };
    }

    const distToEntry = ((price - entryLevel) / entryLevel * 100).toFixed(1);
    return {
      newState: state,
      signal:   null,
      rationale: [...rationale, `${distToEntry}% acima do nível de entrada $${entryLevel}`],
    };
  }

  return { newState: state, signal: null, rationale: ["Monitor já ativado"] };
}

// ── Type 2: BREAKOUT_RETEST ────────────────────────────────────
// Stage machine: watching → broke_above → retesting → triggered

function _evalBreakoutRetest(monitor, state, bars, price, capitalUsdt) {
  const level       = monitor.level;
  const retestTol   = monitor.retest_tolerance_pct ?? 0.012;
  const resetBelow  = monitor.reset_below ?? level * 0.95;

  let stage     = state.stage     ?? "watching";
  let stageData = state.stageData ?? {};
  const lastBar = bars[bars.length - 1];
  const rationale = [];

  // ── Global reset: price dropped far below the level ───────────
  if (price <= resetBelow && stage !== "watching") {
    return {
      newState: { stage: "watching", stageData: {}, resetAt: new Date().toISOString() },
      signal:   null,
      rationale: [`Reset: preço $${price.toFixed(0)} caiu abaixo do reset level $${resetBelow}`],
    };
  }

  // ──────────────────────────────────────────────────────────────
  if (stage === "watching") {
    // Clean breakout: at least 2 of the last 5 bars close above level×1.003
    const recent = bars.slice(-5);
    const closesAbove = recent.filter((b) => b.close > level * 1.003).length;
    const lastTwoAbove = recent.slice(-2).every((b) => b.close > level);

    if (closesAbove < 2 || !lastTwoAbove) {
      return {
        newState: state,
        signal:   null,
        rationale: [`Watching: aguardando rompimento acima de $${level} (+0.3%, 2+ fechamentos)`],
      };
    }

    rationale.push(`Rompimento de $${level} confirmado: ${closesAbove}/5 barras fecharam acima ✓`);

    // Already in retest zone?
    const inRetest = price >= level * 0.995 && price <= level * (1 + retestTol);
    if (inRetest) {
      rationale.push(`Preço $${price.toFixed(0)} já na zona de reteste`);
      return {
        newState: { stage: "retesting", stageData: { level }, retestingAt: new Date().toISOString() },
        signal:   null,
        rationale,
      };
    }

    const breakoutClose = recent[recent.length - 1]?.close ?? price;
    return {
      newState: { stage: "broke_above", stageData: { level, breakoutClose }, brokeAt: new Date().toISOString() },
      signal:   null,
      rationale: [...rationale, `Aguardando pullback ao nível $${level} para reteste`],
    };
  }

  // ──────────────────────────────────────────────────────────────
  if (stage === "broke_above") {
    const breakoutClose = stageData.breakoutClose ?? level;
    rationale.push(`Rompimento de $${level} confirmado (break @ $${breakoutClose?.toFixed(0)}) — aguardando reteste`);
    rationale.push(`Preço atual: $${price.toFixed(0)}`);

    // False breakout: closed back below level
    if (lastBar.close < level * 0.99) {
      return {
        newState: { stage: "watching", stageData: {}, resetAt: new Date().toISOString() },
        signal:   null,
        rationale: [...rationale, `Rompimento FALSO: fechamento abaixo de $${(level * 0.99).toFixed(0)} — reiniciando`],
      };
    }

    // Entered retest zone?
    const inRetest = price >= level * 0.995 && price <= level * (1 + retestTol);
    if (inRetest) {
      rationale.push(`Reteste iniciado: preço $${price.toFixed(0)} voltou ao nível $${level}`);
      return {
        newState: { stage: "retesting", stageData: { level, breakoutClose }, retestingAt: new Date().toISOString() },
        signal:   null,
        rationale,
      };
    }

    return { newState: state, signal: null, rationale };
  }

  // ──────────────────────────────────────────────────────────────
  if (stage === "retesting") {
    rationale.push(`Reteste de $${level} em andamento — verificando sustentação`);
    rationale.push(`Bar atual: open $${lastBar.open.toFixed(0)} high $${lastBar.high.toFixed(0)} low $${lastBar.low.toFixed(0)} close $${lastBar.close.toFixed(0)}`);

    // Failure: closed below the level
    if (lastBar.close < level * 0.99) {
      return {
        newState: { stage: "watching", stageData: {}, resetAt: new Date().toISOString() },
        signal:   null,
        rationale: [...rationale, `Reteste FALHOU: fechamento em $${lastBar.close.toFixed(0)} abaixo de $${level} — nivel perdido, reiniciando`],
      };
    }

    // Success: bar touched near the level (low ≤ level + tolerance) AND held (close ≥ level)
    const touchedLevel = lastBar.low <= level * (1 + retestTol);
    const heldAbove    = lastBar.close >= level;

    if (touchedLevel && heldAbove) {
      rationale.push(
        `Reteste CONFIRMADO: low $${lastBar.low.toFixed(0)} tocou o nível, ` +
        `close $${lastBar.close.toFixed(0)} sustentou acima de $${level} ✓`
      );
      rationale.push(`Entrando LONG — TPs: ${monitor.tp_fixed?.join(" / $") ? "$" + monitor.tp_fixed.join(" / $") : "Fibonacci"}`);
      return {
        newState: { stage: "triggered", stageData, triggeredAt: new Date().toISOString() },
        signal:   _buildSignal(monitor, price, rationale, capitalUsdt),
        rationale,
      };
    }

    const distPct = ((price - level) / level * 100).toFixed(2);
    return {
      newState: state,
      signal:   null,
      rationale: [...rationale, `Aguardando confirmação: preço $${price.toFixed(0)} (+${distPct}% do nível)`],
    };
  }

  return { newState: state, signal: null, rationale: ["Monitor já ativado"] };
}

// ── Signal Builder ─────────────────────────────────────────────

function _buildSignal(monitor, entryPrice, rationale, capitalUsdt) {
  const isLong  = monitor.direction === "LONG";
  const slPct   = monitor.sl_pct  ?? 0.02;
  const capital = capitalUsdt ?? config.capitalUsdt;

  const slPrice = isLong
    ? parseFloat((entryPrice * (1 - slPct)).toFixed(2))
    : parseFloat((entryPrice * (1 + slPct)).toFixed(2));

  const risk = Math.abs(entryPrice - slPrice);

  // Take-profit levels
  let tp1, tp2, tp3;
  if (monitor.tp_fixed?.length) {
    const tps = monitor.tp_fixed;
    tp1 = tps[0] ?? null;
    tp2 = tps[1] ?? null;
    tp3 = tps[2] ?? null;
  } else {
    const tpR = monitor.tp_r ?? { tp1: 1.618, tp2: 2.618, tp3: 4.236 };
    tp1 = isLong ? entryPrice + risk * tpR.tp1 : entryPrice - risk * tpR.tp1;
    tp2 = isLong ? entryPrice + risk * tpR.tp2 : entryPrice - risk * tpR.tp2;
    tp3 = isLong ? entryPrice + risk * tpR.tp3 : entryPrice - risk * tpR.tp3;
    tp1 = parseFloat(tp1.toFixed(2));
    tp2 = parseFloat(tp2.toFixed(2));
    tp3 = parseFloat(tp3.toFixed(2));
  }

  // Position sizing (same 1% risk rule as scanner)
  const riskDollars    = capital * config.maxRiskPct;
  const riskPerUnit    = Math.abs(entryPrice - slPrice);
  const allocationCap  = capital * 0.20; // 20% per slot
  const rawSize        = riskPerUnit > 0 ? riskDollars / riskPerUnit : 0;
  const rawValue       = rawSize * entryPrice;
  const cappedSize     = rawValue > allocationCap ? allocationCap / entryPrice : rawSize;
  const positionSize   = parseFloat(cappedSize.toFixed(6));
  const positionValue  = parseFloat((positionSize * entryPrice).toFixed(2));

  const fullRationale = [
    `MONITOR ATIVADO: ${monitor.name}`,
    `Tipo: ${monitor.type} | Direção: ${monitor.direction}`,
    ...rationale,
    `Sizing: ${positionSize} ETH × $${entryPrice} = $${positionValue} (risco $${riskDollars.toFixed(2)})`,
  ];

  return {
    symbol:    monitor.symbol,
    direction: monitor.direction,
    score:     82, // monitors fire only when all stages confirmed — high confidence
    setup_id:  monitor.id,
    setup_name: monitor.name,
    leverage:  monitor.leverage ?? 3,
    tradeType: "DAY",
    rationale: fullRationale,

    price:    entryPrice,
    entry:    entryPrice,
    avgEntry: entryPrice,
    sl:       slPrice,
    tp1,
    tp2,
    tp3,

    tpDistribution: { tp1Pct: 0.40, tp2Pct: 0.35, tp3Pct: 0.25 },

    scaleEntries: [{
      index:    1,
      price:    entryPrice,
      sl_price: slPrice,
      size:     positionSize,
      value:    positionValue,
    }],
    scaleConfig: { entries: 1, spacingPct: 0, lastEntry: entryPrice, avgEntry: entryPrice },

    sizing: {
      positionSize,
      positionValue,
      riskDollars:   parseFloat(riskDollars.toFixed(2)),
      tradeCapital:  parseFloat(allocationCap.toFixed(2)),
      riskPct:       (config.maxRiskPct * 100).toFixed(2),
      riskPerEntry:  parseFloat(riskDollars.toFixed(2)),
      totalMaxRisk:  parseFloat(riskDollars.toFixed(2)),
      wasCapped:     rawValue > allocationCap,
    },

    breakdown: {
      monitor_id:   monitor.id,
      monitor_type: monitor.type,
      touch_level:  monitor.touch_level ?? null,
      entry_level:  monitor.entry_level ?? null,
      level:        monitor.level ?? null,
    },
    inputs: {},

    createdAt: new Date().toISOString(),
    status:    "PENDING_APPROVAL",
  };
}

// ── Weakness Detection ─────────────────────────────────────────
// Detects bearish momentum loss after a price touch.

function _detectWeakness(touchBar, postBars) {
  if (!postBars.length) return { found: false };

  const firstPost = postBars[0];

  // 1. First post-touch bar is bearish (closes below open)
  if (firstPost.close < firstPost.open) {
    return { found: true, reason: `vela bearish (close $${firstPost.close.toFixed(0)} < open $${firstPost.open.toFixed(0)})` };
  }

  // 2. Touch bar itself had upper-wick rejection (wick > 1.5× body)
  if (touchBar) {
    const body      = Math.abs(touchBar.close - touchBar.open);
    const upperWick = touchBar.high - Math.max(touchBar.open, touchBar.close);
    if (body > 0 && upperWick > body * 1.5) {
      return { found: true, reason: `pin bar / shooting star no toque (wick $${upperWick.toFixed(0)} > 1.5× body $${body.toFixed(0)})` };
    }
  }

  // 3. First post-touch bar closes ≥0.5% below the touch bar's close
  if (touchBar && firstPost.close < touchBar.close * 0.995) {
    return { found: true, reason: `queda brusca pós-toque ($${touchBar.close.toFixed(0)} → $${firstPost.close.toFixed(0)})` };
  }

  return { found: false };
}

// ── Expiry Check ───────────────────────────────────────────────

function _isExpired(monState, expiryHours) {
  if (!expiryHours) return false;
  const startedAt = monState.touchedAt ?? monState.brokeAt ?? monState.retestingAt;
  if (!startedAt) return false;
  const ageMs = Date.now() - new Date(startedAt).getTime();
  return ageMs > expiryHours * 60 * 60 * 1000;
}
