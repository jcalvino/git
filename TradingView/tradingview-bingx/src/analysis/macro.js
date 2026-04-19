// ─────────────────────────────────────────────────────────────────
//  Macro & Sentiment Analysis Module
//  Sources: CoinGlass Fear/Greed + rules.json geopolitical context
// ─────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "fs";
import https from "https";
import config from "../config/index.js";
import { STRATEGY } from "../config/strategy.js";

// ── Fear & Greed Index (CoinGlass public) ─────────────────────

async function getFearGreedIndex() {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "open-api.coinglass.com",
        path: "/public/v2/index/fear_greed_history?limit=1",
        method: "GET",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const latest = parsed.data?.[0] ?? parsed[0];
            resolve({
              value: parseInt(latest?.value ?? latest?.index ?? 50),
              label: latest?.valueClassification ?? latest?.label ?? "Neutral",
              timestamp: latest?.timestamp ?? Date.now(),
            });
          } catch {
            resolve({ value: 50, label: "Neutral (fallback)", error: true });
          }
        });
      }
    );
    req.on("error", () =>
      resolve({ value: 50, label: "Neutral (unavailable)", error: true })
    );
    req.end();
  });
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
