// ─────────────────────────────────────────────────────────────────
//  rules_helper.js — Lê valores de fallback do rules.json
//
//  Procura em ordem:
//    1. Top-level (back-compat): rules.<key>
//    2. Bloco market_context_YYYY_MM_DD mais recente:
//       analyst_inputs[].btc.onchain_metrics.<key>
//
//  Retorna o primeiro valor numérico > minValue (default 1_000)
//  encontrado, com a "source" que indica de onde veio.
// ─────────────────────────────────────────────────────────────────

import { readFileSync } from "fs";

/**
 * @param {string} rulesPath caminho absoluto do rules.json
 * @param {string[]} keys lista de chaves a procurar (ex.: ["realized_price"])
 * @param {{ minValue?: number }} opts
 * @returns {{ value: number, source: string } | null}
 */
export function readOnchainFromRules(rulesPath, keys, { minValue = 1_000 } = {}) {
  try {
    const rules = JSON.parse(readFileSync(rulesPath, "utf8"));

    // 1. Top-level (manual override clássico)
    for (const k of keys) {
      const v = parseFloat(rules[k]);
      if (v > minValue) return { value: v, source: "rules.json (top-level)" };
    }

    // 2. Bloco datado mais recente → analyst_inputs[].btc.onchain_metrics
    const datedKey = Object.keys(rules)
      .filter((k) => k.startsWith("market_context_"))
      .sort()
      .pop();
    if (!datedKey) return null;

    const inputs = rules[datedKey]?.analyst_inputs ?? [];
    for (const input of inputs) {
      const metrics = input?.btc?.onchain_metrics ?? {};
      for (const k of keys) {
        const v = metrics[k];
        if (typeof v === "number" && v > minValue) {
          return { value: v, source: `rules.json analyst:${input.source ?? "anon"}` };
        }
      }
      // Fallback secundário pra CVDD: cycle_floor_projection.low (range, não pontual)
      if (keys.includes("cvdd") && metrics.cycle_floor_projection?.low > minValue) {
        return {
          value: metrics.cycle_floor_projection.low,
          source: `rules.json analyst:${input.source ?? "anon"} (cycle_floor.low)`,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}
