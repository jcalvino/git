// ─────────────────────────────────────────────────────────────────
//  Signal Expiry — Auto-removes stale pending signals
//
//  Called every 30s by the API server. A pending signal is expired when:
//    1. Age > MAX_AGE_HOURS (scanner cycle elapsed; conditions may have changed)
//    2. Current price already crossed the SL (entering would be an instant loss)
//    3. Price moved ENTRY_MISS_PCT past entry[0] (LIMIT orders can't fill;
//       the setup opportunity has passed)
// ─────────────────────────────────────────────────────────────────

import { getPendingSignals, updateSignalStatus } from "../storage/trades.js";
import { getPrice } from "../exchanges/bingx.js";
import { STRATEGY } from "../config/strategy.js";

const { MAX_AGE_HOURS, ENTRY_MISS_PCT } = STRATEGY.SIGNAL_EXPIRY;

/**
 * Check all PENDING_APPROVAL signals and expire the ones that are no longer valid.
 * @returns {Array<{id, symbol, direction, reason}>} list of expired signals
 */
export async function expireStalePendingSignals() {
  const pending = getPendingSignals();
  if (pending.length === 0) return [];

  // Fetch current prices for all unique symbols in one pass
  const symbols = [...new Set(pending.map((s) => s.symbol))];
  const prices  = {};

  await Promise.allSettled(
    symbols.map(async (sym) => {
      try {
        // Convert storage symbol (e.g. "BTCUSDT") → BingX REST symbol ("BTC-USDT")
        const bingxSym = sym.replace("USDT", "-USDT");
        prices[sym] = await getPrice(bingxSym);
      } catch {
        // Price unavailable — skip price checks for this symbol
      }
    })
  );

  const now     = Date.now();
  const expired = [];

  for (const signal of pending) {
    const ageHours = (now - new Date(signal.created_at).getTime()) / 3_600_000;

    // ── 1. Age check ──────────────────────────────────────────────
    if (ageHours > MAX_AGE_HOURS) {
      updateSignalStatus(signal.id, "EXPIRED");
      expired.push({
        id:        signal.id,
        symbol:    signal.symbol,
        direction: signal.direction,
        reason:    `aged out (${ageHours.toFixed(1)}h > ${MAX_AGE_HOURS}h limit)`,
      });
      continue;
    }

    // ── 2 & 3. Price-based checks ─────────────────────────────────
    const price = prices[signal.symbol];
    if (!price || !signal.entry || !signal.sl) continue;

    const entry = parseFloat(signal.entry);
    const sl    = parseFloat(signal.sl);
    let   reason = null;

    if (signal.direction === "LONG") {
      if (price <= sl) {
        // Price already at or below stop loss — entering now would be an instant loss
        reason =
          `SL already breached ` +
          `($${fmt(price)} ≤ SL $${fmt(sl)})`;
      } else if (price > entry * (1 + ENTRY_MISS_PCT)) {
        // Price ran UP past the first entry — LIMIT orders at entry/below won't fill
        reason =
          `entry zone missed ` +
          `($${fmt(price)} > entry $${fmt(entry)} +${(ENTRY_MISS_PCT * 100).toFixed(0)}%)`;
      }
    } else {
      // SHORT
      if (price >= sl) {
        reason =
          `SL already breached ` +
          `($${fmt(price)} ≥ SL $${fmt(sl)})`;
      } else if (price < entry * (1 - ENTRY_MISS_PCT)) {
        // Price dropped DOWN past the first short entry — LIMIT orders above won't fill
        reason =
          `entry zone missed ` +
          `($${fmt(price)} < entry $${fmt(entry)} -${(ENTRY_MISS_PCT * 100).toFixed(0)}%)`;
      }
    }

    if (reason) {
      updateSignalStatus(signal.id, "EXPIRED");
      expired.push({ id: signal.id, symbol: signal.symbol, direction: signal.direction, reason });
    }
  }

  return expired;
}

// Pretty-print price without excessive decimals
function fmt(n) {
  const num = parseFloat(n);
  return num >= 1000 ? num.toLocaleString("en-US", { maximumFractionDigits: 0 })
       : num >= 10   ? num.toFixed(2)
                     : num.toFixed(4);
}
