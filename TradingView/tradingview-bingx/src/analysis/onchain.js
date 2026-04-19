// ─────────────────────────────────────────────────────────────────
//  On-Chain & Derivatives Analysis Module
//  Data sources: BingX (funding rate, OI) + CoinGlass (long/short ratio)
// ─────────────────────────────────────────────────────────────────

import https from "https";
import { getFundingRate, getOpenInterest } from "../exchanges/bingx.js";
import { STRATEGY } from "../config/strategy.js";
import config from "../config/index.js";

// ── CoinGlass API helpers ──────────────────────────────────────

function coinglassGet(path) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    if (config.coinglassApiKey)
      headers["coinglassSecret"] = config.coinglassApiKey;

    const req = https.request(
      {
        hostname: "open-api.coinglass.com",
        path,
        method: "GET",
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.data ?? parsed);
          } catch {
            reject(new Error(`CoinGlass parse error: ${data.slice(0, 100)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/** Get long/short account ratio from CoinGlass */
async function getLongShortRatio(symbol) {
  const coin = symbol.replace("USDT", "").replace("-USDT", "");
  try {
    const data = await coinglassGet(
      `/public/v2/indicator/top_long_short_account_ratio?symbol=${coin}&interval=h4&limit=1`
    );
    if (Array.isArray(data) && data.length > 0) {
      const latest = data[0];
      return {
        longPct: parseFloat(latest.longAccount ?? latest.longRatio ?? 50),
        shortPct: parseFloat(latest.shortAccount ?? latest.shortRatio ?? 50),
        timestamp: latest.createTime ?? Date.now(),
      };
    }
  } catch {
    // fallback — CoinGlass rate limits hit
  }
  return null;
}

// ── Main Analysis ──────────────────────────────────────────────

/**
 * Analyze on-chain/derivatives data for a symbol.
 * Combines funding rate, OI, and long/short positioning.
 */
export async function analyzeOnChain(symbol) {
  const bingxSymbol = symbol.includes("-") ? symbol : symbol.replace("USDT", "-USDT");

  const [fundingResult, oiResult, lsResult] = await Promise.allSettled([
    getFundingRate(bingxSymbol),
    getOpenInterest(bingxSymbol),
    getLongShortRatio(symbol),
  ]);

  const funding =
    fundingResult.status === "fulfilled" ? fundingResult.value : null;
  const oi = oiResult.status === "fulfilled" ? oiResult.value : null;
  const longShort = lsResult.status === "fulfilled" ? lsResult.value : null;

  // Interpret funding rate
  let fundingSignal = "neutral";
  if (funding) {
    if (funding.fundingRate <= STRATEGY.FUNDING.BULLISH_THRESHOLD) {
      fundingSignal = "bullish"; // shorts paying longs → long pressure
    } else if (funding.fundingRate >= STRATEGY.FUNDING.BEARISH_THRESHOLD) {
      fundingSignal = "bearish"; // longs paying shorts → short pressure
    }
  }

  // Interpret long/short ratio
  // Contrarian: extreme longs = bearish, extreme shorts = bullish
  let lsSignal = "neutral";
  let lsNote = "";
  if (longShort) {
    const { longPct } = longShort;
    if (longPct > 65) {
      lsSignal = "bearish"; // too many longs = potential squeeze down
      lsNote = `${longPct.toFixed(1)}% longs — crowded long, contrarian bearish`;
    } else if (longPct < 35) {
      lsSignal = "bullish"; // too many shorts = potential squeeze up
      lsNote = `${longPct.toFixed(1)}% longs (${(100 - longPct).toFixed(1)}% shorts) — crowded short, contrarian bullish`;
    } else {
      lsNote = `${longPct.toFixed(1)}% longs — balanced positioning`;
    }
  }

  return {
    symbol,
    timestamp: new Date().toISOString(),

    funding: funding
      ? {
          rate: funding.fundingRate,
          ratePct: (funding.fundingRate * 100).toFixed(4),
          nextFundingTime: funding.nextFundingTime,
          signal: fundingSignal,
        }
      : null,

    openInterest: oi
      ? {
          amount: oi.openInterest,
          value: oi.openInterestValue,
        }
      : null,

    longShort: longShort
      ? {
          longPct: longShort.longPct,
          shortPct: longShort.shortPct,
          signal: lsSignal,
          note: lsNote,
        }
      : null,
  };
}

/**
 * Score on-chain analysis (0–35 points max).
 */
export function scoreOnChain(analysis, direction) {
  const w = STRATEGY.SCORING_WEIGHTS;
  let score = 0;
  const breakdown = {};
  const isLong = direction === "LONG";

  // Funding Rate (15 pts)
  if (analysis.funding) {
    const { signal, ratePct } = analysis.funding;
    if ((isLong && signal === "bullish") || (!isLong && signal === "bearish")) {
      score += w.FUNDING_RATE;
      breakdown.funding = `+${w.FUNDING_RATE} (funding ${ratePct}% — ${signal})`;
    } else if (signal === "neutral") {
      const partial = Math.round(w.FUNDING_RATE * 0.6);
      score += partial;
      breakdown.funding = `+${partial} (funding ${ratePct}% neutral)`;
    } else {
      breakdown.funding = `0 (funding ${ratePct}% — ${signal}, against ${direction})`;
    }
  } else {
    breakdown.funding = "0 (funding rate unavailable)";
  }

  // Long/Short Ratio (10 pts)
  if (analysis.longShort) {
    const { signal, note } = analysis.longShort;
    if ((isLong && signal === "bullish") || (!isLong && signal === "bearish")) {
      score += w.LONG_SHORT_RATIO;
      breakdown.longShort = `+${w.LONG_SHORT_RATIO} (${note})`;
    } else if (signal === "neutral") {
      const partial = Math.round(w.LONG_SHORT_RATIO * 0.5);
      score += partial;
      breakdown.longShort = `+${partial} (${note})`;
    } else {
      breakdown.longShort = `0 (${note} — against ${direction})`;
    }
  } else {
    // If data unavailable, give partial credit (don't penalize)
    const partial = Math.round(w.LONG_SHORT_RATIO * 0.5);
    score += partial;
    breakdown.longShort = `+${partial} (long/short ratio unavailable — neutral assumed)`;
  }

  return { score, breakdown, maxScore: 35 };
}
