// ─────────────────────────────────────────────────────────────────
//  Market Metrics — cached snapshot updated every scanner cycle (5 min)
//
//  Metrics collected:
//    • BTC Dominance      — CoinGecko global (free, no key)
//    • Funding Rate BTC   — BingX
//    • Funding Rate ETH   — BingX
//    • Realized Price     — bitcoinmagazinepro.com → CoinGlass → rules.json
//    • CVDD               — bitcoinmagazinepro.com → rules.json
//    • STH Realized Price — sth_price.js (existing module)
//
//  Cache: data/market_metrics.json (5-min TTL)
//  Manual fallback: add keys to rules.json →
//    { "realized_price": 50000, "cvdd": 25000 }
// ─────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getFundingRate } from "../exchanges/bingx.js";
import { getSTHRealizedPrice } from "./sth_price.js";
import { getLTHRealizedPrice } from "./lth_price.js";
import { readOnchainFromRules } from "./rules_helper.js";
import { saveOnchainSnapshot } from "../storage/trades.js";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, "../..");
const CACHE_PATH = resolve(ROOT, "data/market_metrics.json");
const RULES_PATH = resolve(ROOT, "rules.json");

const CACHE_TTL  = 5 * 60 * 1000;   // 5 min — matches scanner interval
const USER_AGENT = "Mozilla/5.0 (compatible; trading-bot/1.0)";

// ── Cache I/O ──────────────────────────────────────────────────

function loadCache() {
  try {
    if (!existsSync(CACHE_PATH)) return {};
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch { return {}; }
}

function saveCache(data) {
  try {
    const dir = resolve(ROOT, "data");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      CACHE_PATH,
      JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2)
    );
  } catch { /* non-critical — in-memory result still returned */ }
}

function readRulesJson() {
  try { return JSON.parse(readFileSync(RULES_PATH, "utf8")); }
  catch { return {}; }
}

// ── BTC spot price — fallback para o caller que não passar ────
async function _fetchBtcPrice() {
  try {
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDC",
      { signal: AbortSignal.timeout(4000), headers: { Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const p = parseFloat(json?.price);
    return isNaN(p) ? null : p;
  } catch { return null; }
}

// ── ETH spot price (mesmo pattern) ────────────────────────────
async function _fetchEthPrice() {
  try {
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDC",
      { signal: AbortSignal.timeout(4000), headers: { Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const p = parseFloat(json?.price);
    return isNaN(p) ? null : p;
  } catch { return null; }
}

// ── BTC Dominance — CoinGecko (free, no API key) ──────────────

async function _fetchBtcDominance() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/global", {
      signal:  AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const pct  = parseFloat(json.data?.bitcoin_dominance_percentage);
    return isNaN(pct) ? null : parseFloat(pct.toFixed(2));
  } catch { return null; }
}

// ── Funding Rates — BingX ──────────────────────────────────────

async function _fetchFundingRates() {
  const [btcRes, ethRes] = await Promise.allSettled([
    getFundingRate("BTC-USDT"),
    getFundingRate("ETH-USDT"),
  ]);
  return {
    btc: btcRes.status === "fulfilled" ? btcRes.value : null,
    eth: ethRes.status === "fulfilled" ? ethRes.value : null,
  };
}

// ── Realized Price — bitcoinmagazinepro → CoinGlass → rules.json ─

async function _fetchRealizedPrice() {
  const endpoints = [
    "https://www.bitcoinmagazinepro.com/api/indicators/realized-price",
    "https://www.bitcoinmagazinepro.com/api/chart-data?indicator=realized_price",
    "https://open-api.coinglass.com/public/v2/indicator/realized_price_model?symbol=BTC",
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        signal:  AbortSignal.timeout(5000),
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const val  = _extractPrice(json, ["realized_price", "realizedPrice", "value", "price"]);
      if (val && val > 1_000) return val;
    } catch { /* try next */ }
  }

  // Fallback: rules.json — top-level OR analyst_inputs[].btc.onchain_metrics
  const found = readOnchainFromRules(RULES_PATH, ["realized_price"]);
  return found?.value ?? null;
}

// ── CVDD — bitcoinmagazinepro → rules.json ─────────────────────
// Coin Value Days Destroyed: proxy for market bottom (from Glassnode methodology).
// Free sources are unreliable — manual fallback in rules.json is the safety net.

async function _fetchCvdd() {
  const endpoints = [
    "https://www.bitcoinmagazinepro.com/api/indicators/cvdd",
    "https://www.bitcoinmagazinepro.com/api/chart-data?indicator=cvdd",
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        signal:  AbortSignal.timeout(5000),
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const val  = _extractPrice(json, ["cvdd", "value", "price"]);
      if (val && val > 1_000) return val;
    } catch { /* try next */ }
  }

  // Fallback: rules.json — top-level "cvdd" OR analyst_inputs[].btc.onchain_metrics.cvdd
  // OU analyst_inputs[].btc.onchain_metrics.cycle_floor_projection.low (range, ver helper)
  const found = readOnchainFromRules(RULES_PATH, ["cvdd"]);
  return found?.value ?? null;
}

// ── Deep value extractor ───────────────────────────────────────

function _extractPrice(obj, keys) {
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
      const nested = _extractPrice(v, keys);
      if (nested) return nested;
    }
  }
  return null;
}

// ── Public: refresh all metrics and persist to cache ──────────

/**
 * Fetch all market metrics and write to disk cache.
 * Called on every scanner cycle (every 5 min).
 *
 * @param {number|null} btcPrice — pass current BTC price for STH proximity calc
 * @returns {Promise<MarketMetrics>}
 */
export async function refreshMarketMetrics(btcPrice = null) {
  // Se o caller não passou preço, busca direto da Binance.
  // Necessário pra calcular MVRV e persistir snapshot consistente.
  if (!btcPrice) btcPrice = await _fetchBtcPrice();
  const ethPrice = await _fetchEthPrice();

  const [dominanceRes, fundingRes, realizedRes, cvddRes, sthRes, lthRes] =
    await Promise.allSettled([
      _fetchBtcDominance(),
      _fetchFundingRates(),
      _fetchRealizedPrice(),
      _fetchCvdd(),
      getSTHRealizedPrice(btcPrice),
      getLTHRealizedPrice(),
    ]);

  // Funding rate signal helper
  const fundingSignal = (rate) => {
    if (rate == null) return "neutral";
    if (rate <=  -0.0001) return "bullish";  // shorts paying longs → bullish
    if (rate >=   0.0001) return "bearish";  // longs paying shorts → bearish
    return "neutral";
  };

  const funding = fundingRes.status === "fulfilled" ? fundingRes.value : { btc: null, eth: null };
  const sth     = sthRes.status     === "fulfilled" ? sthRes.value     : null;
  const lth     = lthRes.status     === "fulfilled" ? lthRes.value     : null;

  const realizedPrice = realizedRes.status === "fulfilled" ? realizedRes.value : null;
  const cvdd          = cvddRes.status     === "fulfilled" ? cvddRes.value     : null;

  // MVRV simples (price/realizedPrice) — proxy de Market Cap / Realized Cap.
  // Aproxima bem pra BTC, suficiente pra correlação observacional pós-B.
  const mvrvBtc = (btcPrice && realizedPrice) ? (btcPrice / realizedPrice) : null;

  const metrics = {
    btcDominance:     dominanceRes.status === "fulfilled" ? dominanceRes.value    : null,
    funding: {
      btc: funding.btc ? {
        rate:       funding.btc.fundingRate,
        ratePct:    (funding.btc.fundingRate * 100).toFixed(4),
        signal:     fundingSignal(funding.btc.fundingRate),
        nextTime:   funding.btc.nextFundingTime,
      } : null,
      eth: funding.eth ? {
        rate:       funding.eth.fundingRate,
        ratePct:    (funding.eth.fundingRate * 100).toFixed(4),
        signal:     fundingSignal(funding.eth.fundingRate),
        nextTime:   funding.eth.nextFundingTime,
      } : null,
    },
    realizedPrice,
    cvdd,
    mvrv: mvrvBtc,
    sth: sth ? {
      price:           sth.price,
      source:          sth.source,
      touchProximityPct: sth.touchProximityPct,
      priceAbove:      sth.priceAbove,
      isNearLine:      sth.isNearLine,
      isConverging:    sth.isConverging,
      convergenceStatus: sth.convergenceStatus,
    } : null,
    lth: lth ? {
      price:  lth.price,
      source: lth.source,
    } : null,
  };

  saveCache(metrics);

  // ── Persistência no DB (observability — não afeta scoring) ────
  // Grava 1 row por símbolo. ETH não tem on-chain proprietário ainda
  // (bitcoin-data.com é só BTC), mas captura preço + funding + MVRV
  // = null pra coerência de schema; quando integrar CoinMetrics,
  // ETH ganha métricas próprias sem mudar a tabela.
  try {
    const capturedAt = new Date().toISOString();
    if (btcPrice) {
      saveOnchainSnapshot({
        symbol:         "BTCUSDC",
        price:          btcPrice,
        mvrv:           mvrvBtc,
        realized_price: realizedPrice,
        sth_rp:         sth?.price ?? null,
        lth_rp:         lth?.price ?? null,
        cvdd:           cvdd,
        funding_rate:   funding.btc?.fundingRate ?? null,
        sources: {
          realized: realizedPrice ? "market_metrics" : null,
          sth:      sth?.source ?? null,
          lth:      lth?.source ?? null,
          mvrv:     mvrvBtc ? "computed (price/realized)" : null,
        },
        captured_at: capturedAt,
      });
    }
    // ETH: por enquanto só price + funding (on-chain integra depois com CoinMetrics)
    saveOnchainSnapshot({
      symbol:       "ETHUSDC",
      price:        ethPrice,
      funding_rate: funding.eth?.fundingRate ?? null,
      sources: {
        funding: funding.eth ? "bingx" : null,
        note:    "ETH on-chain pending CoinMetrics integration",
      },
      captured_at: capturedAt,
    });
  } catch (err) {
    // DB opcional — never break scan se falhar
    console.warn(`[METRICS] saveOnchainSnapshot falhou: ${err.message}`);
  }

  console.log(
    `[METRICS] BTC Dom: ${metrics.btcDominance ?? "—"}% | ` +
    `BTC Fund: ${metrics.funding.btc?.ratePct ?? "—"}% | ` +
    `ETH Fund: ${metrics.funding.eth?.ratePct ?? "—"}% | ` +
    `MVRV: ${mvrvBtc ? mvrvBtc.toFixed(2) : "—"} | ` +
    `STH: $${metrics.sth?.price?.toLocaleString() ?? "—"} | ` +
    `LTH: $${metrics.lth?.price?.toLocaleString() ?? "—"} | ` +
    `Realized: $${metrics.realizedPrice?.toLocaleString() ?? "—"} | ` +
    `CVDD: $${metrics.cvdd?.toLocaleString() ?? "—"}`
  );

  return metrics;
}

// ── Public: get cached metrics (trigger background refresh if stale) ──

export function getMarketMetrics() {
  const cache = loadCache();
  if (!cache.updatedAt) return cache;

  const age = Date.now() - new Date(cache.updatedAt).getTime();
  if (age > CACHE_TTL) {
    // Return stale data immediately, refresh in background
    refreshMarketMetrics().catch((err) =>
      console.warn(`[METRICS] Background refresh failed: ${err.message}`)
    );
  }

  return cache;
}
