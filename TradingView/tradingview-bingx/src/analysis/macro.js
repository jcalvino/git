// ─────────────────────────────────────────────────────────────────
//  Macro & Sentiment Analysis Module
//  Sources: CoinGlass Fear/Greed + rules.json geopolitical context
// ─────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "fs";
import https from "https";
import config from "../config/index.js";
import { STRATEGY } from "../config/strategy.js";

// ── Fear & Greed Index — chain de fallback ────────────────────
//
// Ordem das fontes (primeira que responder ok vence):
//   1. alternative.me/fng — fonte canônica, API pública sem key, estável
//   2. CoinGlass public — backup
//   3. rules.json — último recurso (tratado no caller)
//
// Cada fonte tem timeout curto (4s) pra não travar o scan quando uma cai.
// Retorno padronizado: { value, label, source, error? }

function fetchJson(options, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (err) { reject(new Error(`invalid JSON: ${err.message}`)); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
    });
    req.end();
  });
}

async function getFearGreedFromAlternativeMe() {
  const json = await fetchJson({
    hostname: "api.alternative.me",
    path: "/fng/?limit=1",
    method: "GET",
    headers: { "Accept": "application/json", "User-Agent": "tradingview-bingx/1.0" },
  });
  const latest = json?.data?.[0];
  if (!latest?.value) throw new Error("alternative.me: payload sem .data[0].value");
  return {
    value: parseInt(latest.value),
    label: latest.value_classification ?? "Unknown",
    timestamp: latest.timestamp ? parseInt(latest.timestamp) * 1000 : Date.now(),
    source: "alternative.me",
  };
}

async function getFearGreedFromCoinGlass() {
  const json = await fetchJson({
    hostname: "open-api.coinglass.com",
    path: "/public/v2/index/fear_greed_history?limit=1",
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  const latest = json?.data?.[0] ?? json?.[0];
  if (!latest?.value) throw new Error("coinglass: payload sem value");
  return {
    value: parseInt(latest.value ?? latest.index ?? 50),
    label: latest.valueClassification ?? latest.label ?? "Neutral",
    timestamp: latest.timestamp ?? Date.now(),
    source: "coinglass",
  };
}

async function getFearGreedIndex() {
  const sources = [
    { name: "alternative.me", fn: getFearGreedFromAlternativeMe },
    { name: "coinglass",      fn: getFearGreedFromCoinGlass },
  ];
  const errors = [];
  for (const s of sources) {
    try {
      const result = await s.fn();
      if (errors.length > 0) result.tried = errors;
      return result;
    } catch (err) {
      errors.push(`${s.name}: ${err.message}`);
    }
  }
  // Todas falharam — caller usa fallback do rules.json
  return {
    value: 50,
    label: "Neutral (all sources down)",
    source: "fallback",
    error: true,
    tried: errors,
  };
}

// ── Rules.json Context Reader ─────────────────────────────────

function readRulesContext() {
  const rulesPath = config.tvRulesPath;

  if (!existsSync(rulesPath)) {
    return { available: false, note: `rules.json not found at ${rulesPath}` };
  }

  try {
    const rules = JSON.parse(readFileSync(rulesPath, "utf8"));

    // Find the most recent market_context block
    const contextKey = Object.keys(rules)
      .filter((k) => k.startsWith("market_context_"))
      .sort()
      .pop();

    const context = contextKey ? rules[contextKey] : null;
    const riskRules = rules.risk_rules ?? [];

    return {
      available: true,
      overallBias: context?.overall_bias ?? "Unknown",
      fearGreedFromRules: context?.fear_greed_index ?? null,
      fearGreedLabel: context?.fear_greed_label ?? null,
      keyDates: context?.key_dates_ahead ?? [],
      macroDrivers: context?.macro_drivers_to_watch ?? [],
      contrarian: context?.contrarian_signal ?? null,
      riskRules,
      lastUpdated: context?.last_updated ?? contextKey?.replace("market_context_", "") ?? "unknown",
      rawContext: context,
    };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

// ── Risk Rule Checker ──────────────────────────────────────────

function checkRiskRules(riskRules) {
  const today = new Date();
  const warnings = [];

  // Check for time-sensitive rules that mention specific dates
  for (const rule of riskRules) {
    const lower = rule.toLowerCase();

    // FOMC check
    if (lower.includes("fomc")) {
      warnings.push({ type: "FOMC", message: rule, severity: "high" });
    }
    // CPI/NFP check
    if (lower.includes("nfp") || lower.includes("cpi")) {
      warnings.push({ type: "MACRO_EVENT", message: rule, severity: "medium" });
    }
    // Tax deadline
    if (lower.includes("tax deadline")) {
      warnings.push({ type: "TAX_DEADLINE", message: rule, severity: "medium" });
    }
    // Ceasefire/geopolitical
    if (lower.includes("ceasefire") || lower.includes("geopolitic")) {
      warnings.push({ type: "GEO_RISK", message: rule, severity: "high" });
    }
    // Extreme fear rule
    if (lower.includes("extreme fear")) {
      warnings.push({ type: "EXTREME_FEAR", message: rule, severity: "low" });
    }
  }

  return warnings;
}

// ── Score Macro Context ────────────────────────────────────────

function scoreFearGreed(fgValue, direction) {
  const w = STRATEGY.SCORING_WEIGHTS.FEAR_GREED;
  const { FEAR_GREED } = STRATEGY;
  const isLong = direction === "LONG";

  let score = 0;
  let note = "";

  if (isLong) {
    if (fgValue <= FEAR_GREED.EXTREME_FEAR_MAX) {
      // Extreme fear = contrarian long signal
      score = w;
      note = `+${w} (extreme fear ${fgValue} — contrarian long opportunity)`;
    } else if (fgValue <= FEAR_GREED.FEAR_MAX) {
      score = Math.round(w * 0.75);
      note = `+${score} (fear ${fgValue} — favorable for long entry)`;
    } else if (fgValue <= FEAR_GREED.GREED_MIN) {
      score = Math.round(w * 0.5);
      note = `+${score} (neutral ${fgValue})`;
    } else if (fgValue < FEAR_GREED.EXTREME_GREED_MIN) {
      score = Math.round(w * 0.25);
      note = `+${score} (greed ${fgValue} — be cautious on longs)`;
    } else {
      note = `0 (extreme greed ${fgValue} — high risk for long entry)`;
    }
  } else {
    // SHORT direction
    if (fgValue >= FEAR_GREED.EXTREME_GREED_MIN) {
      score = w;
      note = `+${w} (extreme greed ${fgValue} — contrarian short opportunity)`;
    } else if (fgValue >= FEAR_GREED.GREED_MIN) {
      score = Math.round(w * 0.75);
      note = `+${score} (greed ${fgValue} — favorable for short)`;
    } else if (fgValue >= FEAR_GREED.FEAR_MAX) {
      score = Math.round(w * 0.5);
      note = `+${score} (neutral ${fgValue})`;
    } else {
      score = Math.round(w * 0.25);
      note = `+${score} (fear ${fgValue} — risky short)`;
    }
  }

  return { score, note };
}

function scoreMacroContext(context, direction) {
  const w = STRATEGY.SCORING_WEIGHTS.MACRO_CONTEXT;
  const isLong = direction === "LONG";

  if (!context.available) {
    return {
      score: Math.round(w * 0.5),
      note: `+${Math.round(w * 0.5)} (rules.json not available — neutral assumed)`,
    };
  }

  const bias = (context.overallBias ?? "").toLowerCase();
  let score = 0;
  let note = "";

  if (isLong) {
    if (bias.includes("bullish") || bias.includes("recovery")) {
      score = w;
      note = `+${w} (macro bias: "${context.overallBias}")`;
    } else if (bias.includes("neutral") || bias.includes("cautious")) {
      score = Math.round(w * 0.5);
      note = `+${score} (macro bias: "${context.overallBias}")`;
    } else if (bias.includes("bearish")) {
      score = 0;
      note = `0 (macro bias: "${context.overallBias}" — against long)`;
    } else {
      score = Math.round(w * 0.4);
      note = `+${score} (macro bias unclear: "${context.overallBias}")`;
    }
  } else {
    if (bias.includes("bearish")) {
      score = w;
      note = `+${w} (macro bias: "${context.overallBias}")`;
    } else if (bias.includes("neutral") || bias.includes("cautious")) {
      score = Math.round(w * 0.5);
      note = `+${score} (macro bias: "${context.overallBias}")`;
    } else if (bias.includes("bullish") || bias.includes("recovery")) {
      score = 0;
      note = `0 (macro bias: "${context.overallBias}" — against short)`;
    } else {
      score = Math.round(w * 0.4);
      note = `+${score} (macro bias unclear: "${context.overallBias}")`;
    }
  }

  return { score, note };
}

// ── Main Export ────────────────────────────────────────────────

export async function analyzeMacro() {
  const [fearGreed, rulesContext] = await Promise.all([
    getFearGreedIndex(),
    Promise.resolve(readRulesContext()),
  ]);

  // Use rules.json fear/greed if CoinGlass unavailable
  const fgValue =
    fearGreed.error && rulesContext.fearGreedFromRules !== null
      ? rulesContext.fearGreedFromRules
      : fearGreed.value;

  const riskWarnings = checkRiskRules(rulesContext.riskRules ?? []);

  return {
    timestamp: new Date().toISOString(),
    fearGreed: {
      value: fgValue,
      label: fearGreed.label ?? rulesContext.fearGreedLabel ?? "Unknown",
      source: fearGreed.error ? "rules.json" : "coinglass",
    },
    context: rulesContext,
    riskWarnings,
    hasHighRisk: riskWarnings.some((w) => w.severity === "high"),
  };
}

export function scoreMacro(macroAnalysis, direction) {
  const breakdown = {};
  let totalScore = 0;

  // Fear & Greed (10 pts)
  const { score: fgScore, note: fgNote } = scoreFearGreed(
    macroAnalysis.fearGreed.value,
    direction
  );
  totalScore += fgScore;
  breakdown.fearGreed = fgNote;

  // Macro Context (15 pts)
  const { score: ctxScore, note: ctxNote } = scoreMacroContext(
    macroAnalysis.context,
    direction
  );
  totalScore += ctxScore;
  breakdown.macroContext = ctxNote;

  // High-risk warning — reduce score
  if (macroAnalysis.hasHighRisk) {
    const penalty = Math.round(totalScore * 0.3);
    totalScore = Math.max(0, totalScore - penalty);
    breakdown.riskPenalty = `-${penalty} (active high-risk event: ${macroAnalysis.riskWarnings.filter((w) => w.severity === "high").map((w) => w.type).join(", ")})`;
  }

  return { score: totalScore, breakdown, maxScore: 25 };
}
