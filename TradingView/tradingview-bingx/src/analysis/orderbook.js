// ─────────────────────────────────────────────────────────────────
//  Order Book Analysis Module
//  Reads BingX order book and calculates bid/ask imbalance.
// ─────────────────────────────────────────────────────────────────

import { getOrderBook } from "../exchanges/bingx.js";
import { STRATEGY } from "../config/strategy.js";

/**
 * Analyze order book for a symbol.
 * Returns imbalance ratio and directional signal.
 *
 * @param {string} symbol — e.g. "BTCUSDT" or "BTC-USDT"
 * @returns {OrderBookAnalysis}
 */
export async function analyzeOrderBook(symbol) {
  const bingxSymbol = toBingXSymbol(symbol);
  const { bids, asks } = await getOrderBook(
    bingxSymbol,
    STRATEGY.ORDERBOOK.DEPTH_LEVELS
  );

  if (!bids.length || !asks.length) {
    return { symbol, imbalance: 0.5, signal: "neutral", error: "empty book" };
  }

  // Calculate total bid and ask volume within 0.5% of mid price
  const midPrice =
    (bids[0].price + asks[0].price) / 2;
  const rangeFilter = midPrice * 0.005; // 0.5% range

  const totalBidVol = bids
    .filter((b) => b.price >= midPrice - rangeFilter)
    .reduce((sum, b) => sum + b.qty * b.price, 0);

  const totalAskVol = asks
    .filter((a) => a.price <= midPrice + rangeFilter)
    .reduce((sum, a) => sum + a.qty * a.price, 0);

  const totalVol = totalBidVol + totalAskVol;
  const imbalance = totalVol === 0 ? 0.5 : totalBidVol / totalVol;

  // Large walls detection — find clusters > 2x average
  const avgBidSize =
    bids.reduce((s, b) => s + b.qty, 0) / Math.max(bids.length, 1);
  const avgAskSize =
    asks.reduce((s, a) => s + a.qty, 0) / Math.max(asks.length, 1);

  const largeBids = bids.filter((b) => b.qty > avgBidSize * 2);
  const largeAsks = asks.filter((a) => a.qty > avgAskSize * 2);

  const signal =
    imbalance >= STRATEGY.ORDERBOOK.BULL_IMBALANCE
      ? "bullish"
      : imbalance <= STRATEGY.ORDERBOOK.BEAR_IMBALANCE
      ? "bearish"
      : "neutral";

  return {
    symbol,
    midPrice,
    spread: asks[0].price - bids[0].price,
    spreadPct: ((asks[0].price - bids[0].price) / midPrice) * 100,
    imbalance,
    imbalancePct: (imbalance * 100).toFixed(1),
    signal,
    totalBidVol: totalBidVol.toFixed(0),
    totalAskVol: totalAskVol.toFixed(0),
    largeBidWalls: largeBids.slice(0, 3).map((b) => ({
      price: b.price,
      qty: b.qty.toFixed(4),
    })),
    largeAskWalls: largeAsks.slice(0, 3).map((a) => ({
      price: a.price,
      qty: a.qty.toFixed(4),
    })),
    topBid: bids[0]?.price,
    topAsk: asks[0]?.price,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Score order book analysis (0–10 points max).
 */
export function scoreOrderBook(analysis, direction) {
  const w = STRATEGY.SCORING_WEIGHTS.ORDERBOOK;
  const isLong = direction === "LONG";

  if (analysis.error) {
    return { score: 0, breakdown: { orderbook: "0 (order book unavailable)" } };
  }

  const { imbalance, signal } = analysis;

  let score = 0;
  let reason = "";

  if (isLong && signal === "bullish") {
    score = w;
    reason = `+${w} (bid imbalance ${analysis.imbalancePct}% — bullish pressure)`;
  } else if (!isLong && signal === "bearish") {
    score = w;
    reason = `+${w} (ask imbalance ${100 - parseFloat(analysis.imbalancePct)}% — bearish pressure)`;
  } else if (signal === "neutral") {
    score = Math.round(w * 0.5); // partial credit for neutral
    reason = `+${score} (book neutral — imbalance ${analysis.imbalancePct}%)`;
  } else {
    reason = `0 (book ${signal} — against ${direction})`;
  }

  return { score, breakdown: { orderbook: reason } };
}

// ── Helpers ────────────────────────────────────────────────────
function toBingXSymbol(symbol) {
  // BingX perpetual format: BTC-USDT
  if (symbol.includes("-")) return symbol;
  if (symbol === "BTCUSDT") return "BTC-USDT";
  if (symbol === "ETHUSDT") return "ETH-USDT";
  return symbol.replace("USDT", "-USDT");
}
