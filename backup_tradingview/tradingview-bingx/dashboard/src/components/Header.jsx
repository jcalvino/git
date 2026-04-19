import React from "react";

export function Header({ overview, lastUpdate, onRefresh, mode }) {
  const prices = overview?.prices ?? {};
  const balance = overview?.balance ?? {};
  const isLive = mode === "live";

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isLive ? "bg-positive" : "bg-accent"} animate-pulse`} />
          <span className="text-accent font-semibold text-sm tracking-wider">
            BTC/ETH TRADER
          </span>
        </div>
        <span className="text-border">|</span>
        <span className={`text-xs font-medium ${isLive ? "text-positive" : "text-accent"}`}>
          {isLive ? "LIVE" : "PAPER TRADE"}
        </span>
      </div>

      <div className="flex items-center gap-6 text-xs">
        {prices.BTCUSDT && (
          <div className="flex items-center gap-1">
            <span className="text-muted">BTC</span>
            <span className="text-text font-medium">
              ${prices.BTCUSDT.toLocaleString()}
            </span>
          </div>
        )}
        {prices.ETHUSDT && (
          <div className="flex items-center gap-1">
            <span className="text-muted">ETH</span>
            <span className="text-text font-medium">
              ${prices.ETHUSDT.toLocaleString()}
            </span>
          </div>
        )}
        {balance.available !== undefined && (
          <div className="flex items-center gap-1">
            <span className="text-muted">Balance</span>
            <span className="text-accent font-medium">
              ${balance.available.toFixed(2)}
            </span>
          </div>
        )}
        {lastUpdate && (
          <span className="text-muted">
            {lastUpdate.toLocaleTimeString("en-US")}
          </span>
        )}
        <button
          onClick={onRefresh}
          className="px-2 py-1 text-xs border border-border rounded hover:border-accent hover:text-accent transition-colors"
        >
          ↺
        </button>
      </div>
    </header>
  );
}
