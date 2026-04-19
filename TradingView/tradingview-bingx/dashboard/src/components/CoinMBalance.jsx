import React from "react";

/**
 * Shows the Coin-M (BTC-margined) account balance in the Overview tab.
 * Data comes from GET /api/overview → coinMBalance.
 *
 * Only rendered when btcBalance > 0 so it doesn't clutter the UI when
 * the account is empty or the API keys are not configured.
 */
export function CoinMBalance({ coinMBalance }) {
  if (!coinMBalance || coinMBalance.btcBalance <= 0) return null;

  const {
    btcBalance,
    btcAvailable,
    usdtEquivalent,
    btcPrice,
    configuredCapital,
  } = coinMBalance;

  const unrealized = btcBalance - (configuredCapital ?? btcBalance);
  const unrealizedUsd = unrealized * (btcPrice ?? 0);

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs text-muted tracking-wider">COIN-M ACCOUNT (BTC-USD)</h2>
        <span className="px-2 py-0.5 rounded text-xs font-bold bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">
          BTC-margined
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <BalanceStat
          label="Total BTC"
          value={`${btcBalance.toFixed(6)} BTC`}
          color="text-yellow-400"
        />
        <BalanceStat
          label="USD Equivalent"
          value={`$${usdtEquivalent.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
          color="text-accent"
        />
        <BalanceStat
          label="Available BTC"
          value={`${btcAvailable.toFixed(6)} BTC`}
        />
        <BalanceStat
          label="BTC Price"
          value={`$${Math.round(btcPrice).toLocaleString()}`}
          sub="mark price"
        />
      </div>

      {/* In-margin BTC (difference between total and available) */}
      {btcBalance - btcAvailable > 0.000001 && (
        <div className="mt-3 pt-3 border-t border-border/30 flex items-center gap-6 text-xs text-muted">
          <span>
            In margin:{" "}
            <span className="text-text">
              {(btcBalance - btcAvailable).toFixed(6)} BTC
            </span>
          </span>
          <span>
            Margin value:{" "}
            <span className="text-text">
              ${((btcBalance - btcAvailable) * btcPrice).toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function BalanceStat({ label, value, color = "text-text", sub }) {
  return (
    <div className="bg-bg rounded p-3">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className={`font-bold font-mono text-sm ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
}
