// ─────────────────────────────────────────────────────────────────
//  STH Realized Price
//  Short-Term Holder Realized Price — average acquisition cost of
//  BTC coins last moved within the past 155 days.
//
//  When BTC price touches this level it acts as key S/R (Setup 2).
//  Source: bitcoinmagazinepro.com / Glassnode (yellow line)
//
//  Data source priority:
//  1. CoinGlass on-chain API (realized_price_model endpoint)
//  2. rules.json manual override (key: "sth_realized_price")
//
//  To set manually: add to rules.json → { "sth_realized_price": 75000 }
// ─────────────────────────────────────────────────────────────────

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolve(__dirname, "../../rules.json");

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — STH realized price moves slowly
let _cache = { value: null, fetchedAt: 0, source: null };

/**
 * Fetch the STH Realized Price for BTC.
 *
 * @param {number|null} currentPrice — BTC current price (for proximity calc)
 * @returns {Promise<STHResult>}
 *
 * @typedef {Object} STHResult
 * @property {number|null} price          — STH Realized Price in USD
 * @property {string|null} source         — "coinglass" | "rules.json" | null
 * @property {number|null} touchProximityPct — how close price is to STH line (%)
 * @property {boolean|null} priceAbove    — true if current price is above STH line
 * @property {boolean}      isNearLine    — true if within setup2.touch_pct threshold
 * @property {number|null}  currentPrice  — the price passed in
 */
export async function getSTHRealizedPrice(currentPrice = null) {
  const now = Date.now();
  if (_cache.value && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return _buildResult(_cache.value, _cache.source, currentPrice);
  }

  // ── 1. CoinGlass on-chain realized price model ─────────────────
  try {
    const res = await fetch(
      "https://open-api.coinglass.com/public/v2/indicator/realized_price_model?symbol=BTC",
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const json = await res.json();
      const sth = _extractCoinGlassSTH(json);
      if (sth && sth > 1000) {
        _cache = { value: sth, fetchedAt: now, source: "coinglass" };
        return _buildResult(sth, "coinglass", currentPrice);
      }
    }
  } catch {
    // CoinGlass not reachable or endpoint changed
  }

  // ── 2. rules.json manual override ─────────────────────────────
  try {
    const rules = JSON.parse(readFileSync(RULES_PATH, "utf8"));
    const manual = parseFloat(rules.sth_realized_price);
    if (manual && manual > 1000) {
      _cache = { value: manual, fetchedAt: now, source: "rules.json" };
      return _buildResult(manual, "rules.json", currentPrice);
    }
  } catch {
    // rules.json missing or malformed
  }

  return { price: null, source: null, touchProximityPct: null, priceAbove: null, isNearLine: false, currentPrice };
}

// ── Helpers ────────────────────────────────────────────────────

function _extractCoinGlassSTH(data) {
  if (!data?.data) return null;

  // Format 1: flat object with named keys
  if (typeof data.data === "object" && !Array.isArray(data.data)) {
    const d = data.data;
    // Try common field names
    for (const key of ["sthRealizedPrice", "sth_realized_price", "shortTermHolderRealizedPrice"]) {
      if (d[key] && parseFloat(d[key]) > 0) return parseFloat(d[key]);
    }
  }

  // Format 2: array of { name, value } entries
  if (Array.isArray(data.data)) {
    for (const entry of data.data) {
      const name = (entry.name ?? entry.type ?? "").toLowerCase();
      if (name.includes("short") || name.includes("sth")) {
        const v = parseFloat(entry.value ?? entry.price ?? 0);
        if (v > 0) return v;
      }
    }
  }

  // Format 3: data.data.list array
  if (Array.isArray(data.data?.list)) {
    for (const entry of data.data.list) {
      const name = (entry.name ?? "").toLowerCase();
      if (name.includes("short") || name.includes("sth")) {
        const v = parseFloat(entry.value ?? 0);
        if (v > 0) return v;
      }
    }
  }

  return null;
}

function _buildResult(sthPrice, source, currentPrice) {
  const result = { price: sthPrice, source, currentPrice };

  if (currentPrice && sthPrice) {
    const proximity = Math.abs((currentPrice - sthPrice) / sthPrice) * 100;
    result.touchProximityPct = parseFloat(proximity.toFixed(2));
    result.priceAbove = currentPrice > sthPrice;
    // Within 1.5% counts as "touching" the line (configurable via SETUPS.STH_REALIZED_PRICE.touch_pct)
    result.isNearLine = proximity <= 1.5;
  } else {
    result.touchProximityPct = null;
    result.priceAbove = null;
    result.isNearLine = false;
  }

  return result;
}
