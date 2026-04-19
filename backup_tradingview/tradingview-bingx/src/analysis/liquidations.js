// ─────────────────────────────────────────────────────────────────
//  Liquidation Heatmap Analysis (24h)
//  BTC/USDT Binance perpetuals — CoinGlass data
//
//  Setup 5 signal: when a large cluster of liquidations accumulates
//  in one direction AFTER the opposite side was recently cleared,
//  the market tends to push toward the accumulated zone.
//
//  Logic:
//  - Fetch 24h BTC liquidation levels from CoinGlass
//  - Split zones into above/below current price (±5% range)
//  - "Above" zones = short liquidations (triggered if price rises)
//  - "Below" zones = long liquidations (triggered if price drops)
//  - Signal LONG  when ≥65% of nearby liq is above (shorts get hunted)
//  - Signal SHORT when ≥65% of nearby liq is below (longs get hunted)
// ─────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min — heatmap changes frequently
const SCAN_RANGE_PCT = 0.05;          // look ±5% from current price
const DOMINANCE_THRESHOLD = 0.65;     // one side must have ≥65% of nearby liq

let _cache = { raw: null, fetchedAt: 0 };

/**
 * Fetch and analyze BTC liquidation heatmap for the next likely move.
 *
 * @param {number} currentPrice — BTC current price
 * @returns {Promise<LiquidationAnalysis>}
 *
 * @typedef {Object} LiquidationAnalysis
 * @property {boolean}       available
 * @property {"LONG"|"SHORT"|"NEUTRAL"} signal
 * @property {string|null}   direction   — same as signal but null when NEUTRAL
 * @property {string[]}      rationale   — human-readable explanation
 * @property {number}        aboveTotal  — total short liq above (millions USD)
 * @property {number}        belowTotal  — total long liq below (millions USD)
 * @property {number}        aboveRatio  — fraction of nearby liq that is above
 * @property {number}        currentPrice
 */
export async function analyzeLiquidations(currentPrice) {
  const now = Date.now();

  if (!_cache.raw || now - _cache.fetchedAt > CACHE_TTL_MS) {
    const raw = await _fetchHeatmap();
    if (raw) _cache = { raw, fetchedAt: now };
  }

  if (!_cache.raw) {
    return {
      available: false,
      signal: "NEUTRAL",
      direction: null,
      rationale: ["Dados de liquidações indisponíveis (CoinGlass API não acessível)"],
      aboveTotal: 0,
      belowTotal: 0,
      aboveRatio: 0.5,
      currentPrice,
    };
  }

  return _analyzeZones(_cache.raw, currentPrice);
}

// ── Data Fetching ──────────────────────────────────────────────

async function _fetchHeatmap() {
  // Try multiple CoinGlass endpoint variants
  const endpoints = [
    "https://open-api.coinglass.com/public/v2/liquidation_heatmap?symbol=BTC&exchange=Binance&timeType=0",
    "https://open-api.coinglass.com/api/pro/v1/futures/liquidation/heatmap?symbol=BTC&timeType=0",
    "https://open-api.coinglass.com/public/v2/futures/liquidation/map?symbol=BTCUSDT&exchange=binance",
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const json = await res.json();
      if (json?.data) return json.data;
    } catch {
      // try next endpoint
    }
  }
  return null;
}

// ── Zone Analysis ──────────────────────────────────────────────

function _analyzeZones(raw, currentPrice) {
  const zones = _parseHeatmap(raw, currentPrice);

  if (!zones.length) {
    return {
      available: true,
      signal: "NEUTRAL",
      direction: null,
      rationale: ["Nenhuma zona de liquidação identificada no heatmap"],
      aboveTotal: 0,
      belowTotal: 0,
      aboveRatio: 0.5,
      currentPrice,
    };
  }

  const rangeLow  = currentPrice * (1 - SCAN_RANGE_PCT);
  const rangeHigh = currentPrice * (1 + SCAN_RANGE_PCT);

  // Above current price → shorts would be liquidated if price rises
  const aboveZones = zones.filter((z) => z.price > currentPrice && z.price <= rangeHigh);
  // Below current price → longs would be liquidated if price falls
  const belowZones = zones.filter((z) => z.price < currentPrice && z.price >= rangeLow);

  // Aggregate: "shortLiq" in above zones (shorts stacked there)
  //            "longLiq"  in below zones (longs stacked there)
  const aboveTotal = aboveZones.reduce((s, z) => s + z.shortLiq, 0);
  const belowTotal = belowZones.reduce((s, z) => s + z.longLiq, 0);
  const totalLiq   = aboveTotal + belowTotal;

  if (totalLiq < 1) {
    return {
      available: true,
      signal: "NEUTRAL",
      direction: null,
      rationale: [
        `Liquidações nas zonas próximas insuficientes ($${totalLiq.toFixed(1)}M total)`,
        `Faixa analisada: $${rangeLow.toFixed(0)} – $${rangeHigh.toFixed(0)}`,
      ],
      aboveTotal: 0,
      belowTotal: 0,
      aboveRatio: 0.5,
      currentPrice,
    };
  }

  const aboveRatio = aboveTotal / totalLiq;
  const belowRatio = 1 - aboveRatio;

  const topAbove = aboveZones.sort((a, b) => b.shortLiq - a.shortLiq)[0];
  const topBelow = belowZones.sort((a, b) => b.longLiq  - a.longLiq)[0];

  const rationale = [];
  let signal    = "NEUTRAL";
  let direction = null;

  if (aboveRatio >= DOMINANCE_THRESHOLD && aboveTotal > belowTotal * 1.5) {
    // Dominant short-liq cluster above → market likely to hunt those stops
    signal    = "LONG";
    direction = "LONG";
    rationale.push(
      `${(aboveRatio * 100).toFixed(0)}% das liquidações próximas estão ACIMA do preço ($${aboveTotal.toFixed(0)}M)`
    );
    if (topAbove) {
      const dist = ((topAbove.price - currentPrice) / currentPrice * 100).toFixed(1);
      rationale.push(
        `Maior cluster de shorts em $${topAbove.price.toLocaleString()} (+${dist}% — $${topAbove.shortLiq.toFixed(0)}M)`
      );
    }
    rationale.push(
      `Mercado tende a subir para liquidar esses shorts em cascata (long squeeze inverso)`
    );

  } else if (belowRatio >= DOMINANCE_THRESHOLD && belowTotal > aboveTotal * 1.5) {
    // Dominant long-liq cluster below → market likely to flush longs
    signal    = "SHORT";
    direction = "SHORT";
    rationale.push(
      `${(belowRatio * 100).toFixed(0)}% das liquidações próximas estão ABAIXO do preço ($${belowTotal.toFixed(0)}M)`
    );
    if (topBelow) {
      const dist = ((currentPrice - topBelow.price) / currentPrice * 100).toFixed(1);
      rationale.push(
        `Maior cluster de longs em $${topBelow.price.toLocaleString()} (-${dist}% — $${topBelow.longLiq.toFixed(0)}M)`
      );
    }
    rationale.push(
      `Mercado tende a cair para liquidar esses longs em cascata`
    );

  } else {
    rationale.push(
      `Distribuição equilibrada: ${(aboveRatio * 100).toFixed(0)}% acima / ${(belowRatio * 100).toFixed(0)}% abaixo`
    );
    rationale.push("Sem viés claro de liquidação nas proximidades — aguardar acúmulo direcional");
  }

  return {
    available: true,
    signal,
    direction,
    rationale,
    aboveTotal: parseFloat(aboveTotal.toFixed(2)),
    belowTotal: parseFloat(belowTotal.toFixed(2)),
    aboveRatio: parseFloat(aboveRatio.toFixed(3)),
    topAbovePrice: topAbove?.price ?? null,
    topBelowPrice: topBelow?.price ?? null,
    currentPrice,
  };
}

// ── Heatmap Parser ─────────────────────────────────────────────
// Normalizes various CoinGlass API response shapes into:
//   [{ price, longLiq, shortLiq }]

function _parseHeatmap(data, currentPrice) {
  const zones = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      const price    = parseFloat(item.price ?? item.liqPrice ?? 0);
      const longLiq  = parseFloat(item.longLiquidationAmount ?? item.buyLiq ?? item.long ?? 0);
      const shortLiq = parseFloat(item.shortLiquidationAmount ?? item.sellLiq ?? item.short ?? 0);
      if (price > 0 && (longLiq > 0 || shortLiq > 0)) {
        zones.push({ price, longLiq, shortLiq });
      }
    }

  } else if (data && typeof data === "object") {
    // Pro API: separate price and amount arrays
    const prices  = data.liqLevelPrices ?? data.prices ?? [];
    const longs   = data.longLiqAmounts ?? data.longs ?? [];
    const shorts  = data.shortLiqAmounts ?? data.shorts ?? [];
    const amounts = data.liqLevelAmounts ?? data.amounts ?? [];

    for (let i = 0; i < prices.length; i++) {
      const price    = parseFloat(prices[i]);
      const longLiq  = parseFloat(longs[i] ?? 0);
      const shortLiq = parseFloat(shorts[i] ?? 0);

      // If unified amounts, infer direction from position relative to current price
      const unifiedAmt = parseFloat(amounts[i] ?? 0);
      if (price > 0) {
        zones.push({
          price,
          longLiq:  longLiq  > 0 ? longLiq  : (price < currentPrice ? unifiedAmt : 0),
          shortLiq: shortLiq > 0 ? shortLiq : (price > currentPrice ? unifiedAmt : 0),
        });
      }
    }
  }

  return zones.filter((z) => z.price > 0 && (z.longLiq > 0 || z.shortLiq > 0));
}
