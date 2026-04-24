// ─────────────────────────────────────────────────────────────────
//  STH Realized Price Monitor
//  Short-Term Holder Realized Price — average cost basis of BTC
//  coins last moved within the past 155 days.
//
//  When BTC price approaches this level it acts as key S/R (Setup 2).
//  This module is called on every 2-min scanner cycle.
//
//  Data source priority:
//  1. bitcoinmagazinepro.com page scrape (tries /api/ endpoints first)
//  2. CoinGlass on-chain API (realized_price_model endpoint)
//  3. rules.json manual override (key: "sth_realized_price")
//
//  To set/override manually: add to rules.json →
//    { "sth_realized_price": 75000 }
//
//  Proximity history: the module records the last 20 readings so
//  the scanner can detect when price is CONVERGING toward the line
//  (getting significantly closer since the last scan cycle).
// ─────────────────────────────────────────────────────────────────

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readOnchainFromRules } from "./rules_helper.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolve(__dirname, "../../rules.json");

// ── Cache ──────────────────────────────────────────────────────
const STH_CACHE_TTL_MS = 60 * 60 * 1000; // 1 h — STH price changes slowly
let _sthCache = { value: null, fetchedAt: 0, source: null };

// ── Proximity History ──────────────────────────────────────────
// Stores the last 20 proximity readings so the scanner can detect
// when price is converging toward the STH line.
// { pct: number, priceAbove: boolean, ts: number }
const HISTORY_MAX = 20;
let _proximityHistory = [];

/**
 * Fetch the STH Realized Price for BTC and compute proximity metrics.
 *
 * @param {number|null} currentPrice — BTC current price (for proximity calc)
 * @returns {Promise<STHResult>}
 *
 * @typedef {Object} STHResult
 * @property {number|null}  price              — STH Realized Price in USD
 * @property {string|null}  source             — "bmp" | "coinglass" | "rules.json" | null
 * @property {number|null}  touchProximityPct  — how close price is to STH line (%)
 * @property {boolean|null} priceAbove         — true if BTC price is above STH line
 * @property {boolean}      isNearLine         — within touch_pct threshold
 * @property {boolean}      isConverging       — price getting significantly closer since last scan
 * @property {number|null}  proximityDelta     — change in proximity since last reading (negative = converging)
 * @property {string}       convergenceStatus  — human-readable description of trajectory
 * @property {number|null}  currentPrice       — the BTC price passed in
 */
export async function getSTHRealizedPrice(currentPrice = null) {
  const sthPrice = await _fetchSTHPrice();

  const result = _buildResult(sthPrice.value, sthPrice.source, currentPrice);

  // Update proximity history and compute convergence
  if (result.touchProximityPct !== null) {
    _recordProximity(result.touchProximityPct, result.priceAbove);
    const convergence = _computeConvergence();
    result.isConverging    = convergence.isConverging;
    result.proximityDelta  = convergence.delta;
    result.convergenceStatus = convergence.status;
    result.historyLength   = _proximityHistory.length;
  } else {
    result.isConverging    = false;
    result.proximityDelta  = null;
    result.convergenceStatus = "STH price unavailable";
    result.historyLength   = 0;
  }

  return result;
}

/**
 * Return the raw proximity history (last N readings).
 * Used by the API to expose monitoring data to the dashboard.
 */
export function getSTHProximityHistory() {
  return [..._proximityHistory];
}

// ── Internal: Fetch STH Price ──────────────────────────────────

async function _fetchSTHPrice() {
  const now = Date.now();
  if (_sthCache.value && now - _sthCache.fetchedAt < STH_CACHE_TTL_MS) {
    return _sthCache;
  }

  // ── 1. bitcoinmagazinepro.com API ─────────────────────────────
  // The site uses an internal API — try common endpoint patterns.
  // Falls through silently if the site's API structure changes.
  const bmpResult = await _tryBitcoinMagazinePro();
  if (bmpResult) {
    _sthCache = { value: bmpResult, fetchedAt: now, source: "bmp" };
    return _sthCache;
  }

  // ── 2. CoinGlass on-chain realized price model ─────────────────
  const cgResult = await _tryCoinGlass();
  if (cgResult) {
    _sthCache = { value: cgResult, fetchedAt: now, source: "coinglass" };
    return _sthCache;
  }

  // ── 3. rules.json manual override ─────────────────────────────
  const manualResult = _tryRulesJson();
  if (manualResult) {
    // Don't cache manual value — re-read every call so updates take effect
    return { value: manualResult, fetchedAt: now, source: "rules.json" };
  }

  return { value: null, fetchedAt: 0, source: null };
}

// ── Source 1: bitcoinmagazinepro.com ──────────────────────────

async function _tryBitcoinMagazinePro() {
  // Try several known API patterns used by chart sites built on Next.js
  const endpoints = [
    "https://www.bitcoinmagazinepro.com/api/indicators/sth-realized-price",
    "https://www.bitcoinmagazinepro.com/api/chart-data?indicator=sth_realized_price",
    "https://www.bitcoinmagazinepro.com/api/metric/short-term-holder-realized-price",
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const val = _extractNumericValue(json, ["price", "value", "sth", "realized_price", "data"]);
      if (val && val > 10_000) return val; // sanity: BTC price in USD > $10k
    } catch {
      // endpoint not found or timed out — try next
    }
  }
  return null;
}

// ── Source 2: CoinGlass ────────────────────────────────────────

async function _tryCoinGlass() {
  const endpoints = [
    "https://open-api.coinglass.com/public/v2/indicator/realized_price_model?symbol=BTC",
    "https://open-api.coinglass.com/public/v2/indicator/on_chain?symbol=BTC&type=sth_realized_price",
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = await res.json();
      const sth = _extractCoinGlassSTH(json);
      if (sth && sth > 10_000) return sth;
    } catch {
      // CoinGlass unreachable or endpoint changed
    }
  }
  return null;
}

// ── Source 3: rules.json manual ───────────────────────────────

function _tryRulesJson() {
  // Procura em (1) top-level rules.sth_realized_price e
  // (2) market_context_YYYY_MM_DD mais recente → analyst_inputs[].btc.onchain_metrics.{sth_cost_basis|sth_realized_price}
  const found = readOnchainFromRules(
    RULES_PATH,
    ["sth_realized_price", "sth_cost_basis"],
    { minValue: 10_000 }, // BTC price-scale sanity
  );
  return found?.value ?? null;
}

// ── Proximity History & Convergence ───────────────────────────

function _recordProximity(pct, priceAbove) {
  _proximityHistory.push({ pct, priceAbove, ts: Date.now() });
  if (_proximityHistory.length > HISTORY_MAX) {
    _proximityHistory.shift();
  }
}

/**
 * Determine if price is converging toward the STH line.
 *
 * Converging = current proximity significantly less than the median
 * of the last several readings (price getting closer).
 *
 * @returns {{ isConverging: boolean, delta: number|null, status: string }}
 */
function _computeConvergence() {
  if (_proximityHistory.length < 3) {
    return { isConverging: false, delta: null, status: "Histórico insuficiente (aguardando 3+ leituras)" };
  }

  const current  = _proximityHistory[_proximityHistory.length - 1].pct;
  // Compare current against the reading from 3 scans ago (6 min window at 2-min scans)
  const lookback = Math.min(5, _proximityHistory.length - 1);
  const pastPct  = _proximityHistory[_proximityHistory.length - 1 - lookback].pct;
  const delta    = parseFloat((current - pastPct).toFixed(2)); // negative = converging

  const isConverging = delta <= -2; // proximity dropped ≥2 percentage points → converging

  let status;
  if (delta <= -5)       status = `⚡ Convergindo rápido: −${Math.abs(delta).toFixed(1)}pp em ${lookback * 2}min`;
  else if (delta <= -2)  status = `↘ Convergindo: −${Math.abs(delta).toFixed(1)}pp em ${lookback * 2}min`;
  else if (delta <= 0)   status = `→ Estável / levemente convergindo: ${delta.toFixed(1)}pp`;
  else                   status = `↗ Afastando: +${delta.toFixed(1)}pp (preço se afasta da linha)`;

  return { isConverging, delta, status };
}

// ── Result Builder ─────────────────────────────────────────────

function _buildResult(sthPrice, source, currentPrice) {
  const result = {
    price:       sthPrice,
    source,
    currentPrice,
    isNearLine:  false,
    isConverging: false,
    proximityDelta: null,
    convergenceStatus: "—",
    historyLength: 0,
  };

  if (currentPrice && sthPrice) {
    const proximity = Math.abs((currentPrice - sthPrice) / sthPrice) * 100;
    result.touchProximityPct = parseFloat(proximity.toFixed(2));
    result.priceAbove        = currentPrice > sthPrice;
    result.isNearLine        = proximity <= 3.0; // 3% threshold
  } else {
    result.touchProximityPct = null;
    result.priceAbove        = null;
  }

  return result;
}

// ── Parse Helpers ──────────────────────────────────────────────

function _extractCoinGlassSTH(data) {
  if (!data?.data) return null;

  if (typeof data.data === "object" && !Array.isArray(data.data)) {
    const d = data.data;
    for (const key of [
      "sthRealizedPrice", "sth_realized_price", "shortTermHolderRealizedPrice",
      "sth_price", "stHolderRealizedPrice",
    ]) {
      if (d[key] && parseFloat(d[key]) > 0) return parseFloat(d[key]);
    }
  }

  if (Array.isArray(data.data)) {
    for (const entry of data.data) {
      const name = (entry.name ?? entry.type ?? "").toLowerCase();
      if (name.includes("short") || name.includes("sth")) {
        const v = parseFloat(entry.value ?? entry.price ?? 0);
        if (v > 0) return v;
      }
    }
  }

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

function _extractNumericValue(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && v > 0) return v;
    if (typeof v === "string" && parseFloat(v) > 0) return parseFloat(v);
    if (typeof v === "object" && v !== null) {
      const nested = _extractNumericValue(v, keys);
      if (nested) return nested;
    }
  }
  return null;
}
