// ─────────────────────────────────────────────────────────────────
//  LTH Realized Price / Cost Basis Monitor
//  Long-Term Holder Realized Price — average cost basis of BTC coins
//  that haven't moved in >155 days. Acts as a structural floor —
//  Cryptocampos cita ~$48k pra essa métrica em abr/2026.
//
//  Usage:
//    const lth = await getLTHRealizedPrice();
//    // → { price, source, fetchedAt, error? }
//
//  Data source priority:
//    1. bitcoin-data.com (/api/v1/metric/lth-realized-price/btc)
//    2. bitcoinmagazinepro.com (page-scrape fallback)
//    3. rules.json manual override (key: "lth_realized_price")
//
//  To set/override manually: add to rules.json →
//    { "lth_realized_price": 48000 }
// ─────────────────────────────────────────────────────────────────

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolve(__dirname, "../../rules.json");
const USER_AGENT = "Mozilla/5.0 (compatible; trading-bot/1.0)";

// ── Cache (LTH muda devagar — refresh 1h é largo o bastante) ──
const LTH_CACHE_TTL_MS = 60 * 60 * 1000;
let _lthCache = { value: null, fetchedAt: 0, source: null };

// ── Source 1: bitcoin-data.com ────────────────────────────────
async function _fetchFromBitcoinData() {
  const candidates = [
    "https://bitcoin-data.com/api/v1/metric/lth-realized-price/btc",
    "https://bitcoin-data.com/api/v1/lth-realized-price",
    "https://bitcoin-data.com/api/v1/metric/long-term-holder-realized-price/btc",
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        signal:  AbortSignal.timeout(5000),
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const v = _extractNumber(json, ["lth_realized_price", "lthRealizedPrice", "value", "price"]);
      if (v && v > 1_000) return { value: v, source: "bitcoin-data.com" };
    } catch { /* try next */ }
  }
  return null;
}

// ── Source 2: bitcoinmagazinepro.com ──────────────────────────
async function _fetchFromBitcoinMagazinePro() {
  const candidates = [
    "https://www.bitcoinmagazinepro.com/api/indicators/long-term-holder-realized-price",
    "https://www.bitcoinmagazinepro.com/api/chart-data?indicator=lth_realized_price",
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        signal:  AbortSignal.timeout(5000),
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const v = _extractNumber(json, ["lth_realized_price", "value", "price"]);
      if (v && v > 1_000) return { value: v, source: "bitcoinmagazinepro.com" };
    } catch { /* try next */ }
  }
  return null;
}

// ── Source 3: rules.json manual override ──────────────────────
function _fetchFromRules() {
  try {
    const rules = JSON.parse(readFileSync(RULES_PATH, "utf8"));
    // Top-level fallback first (back-compat with sth_price.js pattern)
    let v = parseFloat(rules.lth_realized_price);
    if (v > 0) return { value: v, source: "rules.json" };
    // Walk most recent market_context_* → analyst_inputs[].btc.onchain_metrics.lth_cost_basis
    const datedKey = Object.keys(rules)
      .filter((k) => k.startsWith("market_context_"))
      .sort()
      .pop();
    if (!datedKey) return null;
    const inputs = rules[datedKey]?.analyst_inputs ?? [];
    for (const input of inputs) {
      const lth = input?.btc?.onchain_metrics?.lth_cost_basis;
      if (typeof lth === "number" && lth > 1_000) {
        return { value: lth, source: `rules.json (${input.source ?? "analyst"})` };
      }
    }
    return null;
  } catch { return null; }
}

// ── Number extractor (segue padrão do market_metrics.js) ──────
function _extractNumber(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && v > 0) return v;
    if (typeof v === "string") { const n = parseFloat(v); if (n > 0) return n; }
    if (Array.isArray(v) && v.length > 0) {
      const last = v[v.length - 1];
      const n    = typeof last === "number" ? last : parseFloat(last?.value ?? last?.price ?? 0);
      if (n > 0) return n;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = _extractNumber(v, keys);
      if (nested) return nested;
    }
  }
  return null;
}

// ── Public ────────────────────────────────────────────────────
/**
 * @returns {Promise<{price: number|null, source: string|null, fetchedAt: number|null, error?: string}>}
 */
export async function getLTHRealizedPrice() {
  const now = Date.now();
  if (_lthCache.value && now - _lthCache.fetchedAt < LTH_CACHE_TTL_MS) {
    return {
      price:     _lthCache.value,
      source:    _lthCache.source + " (cached)",
      fetchedAt: _lthCache.fetchedAt,
    };
  }

  const sources = [_fetchFromBitcoinData, _fetchFromBitcoinMagazinePro];
  for (const fn of sources) {
    try {
      const result = await fn();
      if (result?.value) {
        _lthCache = { value: result.value, fetchedAt: now, source: result.source };
        return { price: result.value, source: result.source, fetchedAt: now };
      }
    } catch { /* try next */ }
  }

  // Final fallback: rules.json manual override / analyst input
  const fromRules = _fetchFromRules();
  if (fromRules?.value) {
    _lthCache = { value: fromRules.value, fetchedAt: now, source: fromRules.source };
    return { price: fromRules.value, source: fromRules.source, fetchedAt: now };
  }

  return { price: null, source: null, fetchedAt: null, error: "all sources unavailable" };
}
