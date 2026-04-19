import React, { useState } from "react";

export function OpenPositions({ trades = [], onClose }) {
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [confirm, setConfirm] = useState(null); // tradeId awaiting confirm

  const handleClose = async (trade) => {
    if (confirm !== trade.id) {
      setConfirm(trade.id);
      return;
    }
    setConfirm(null);
    setLoading((p) => ({ ...p, [trade.id]: true }));
    setErrors((p) => ({ ...p, [trade.id]: null }));
    try {
      const result = await onClose(trade.id);
      if (result && !result.success) {
        setErrors((p) => ({ ...p, [trade.id]: result.error ?? "Unknown error" }));
      }
    } catch (err) {
      setErrors((p) => ({ ...p, [trade.id]: err.message }));
    } finally {
      setLoading((p) => ({ ...p, [trade.id]: false }));
    }
  };

  if (trades.length === 0) {
    return (
      <div className="text-muted text-sm text-center py-6">
        No open positions
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {trades.map((t) => {
        const pnl = t.unrealized_pnl ?? t.pnl ?? 0;
        const isProfit = pnl >= 0;
        const isExternal = t.trade_type === "EXTERNAL";
        const isLoading = loading[t.id];
        const isConfirming = confirm === t.id;

        return (
          <div
            key={t.id}
            className={`rounded-lg border p-3 text-xs ${
              t.direction === "LONG"
                ? "border-positive/30 bg-positive/5"
                : "border-negative/30 bg-negative/5"
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <span
                className={`px-2 py-0.5 rounded font-bold ${
                  t.direction === "LONG"
                    ? "bg-positive/20 text-positive"
                    : "bg-negative/20 text-negative"
                }`}
              >
                {t.direction}
              </span>
              <span className="font-semibold text-text">{t.symbol}</span>
              {isExternal && (
                <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-xs">
                  external
                </span>
              )}
              <span
                className={`ml-auto font-mono font-bold ${
                  isProfit ? "text-positive" : "text-negative"
                }`}
              >
                {isProfit ? "+" : ""}${pnl.toFixed(2)}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-3 text-xs mb-2">
              <div>
                <span className="text-muted block">Entry</span>
                <span>${t.entry_price?.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted block">SL</span>
                <span className="text-negative">
                  {t.sl_price ? `$${t.sl_price?.toLocaleString()}` : "—"}
                </span>
              </div>
              <div>
                <span className="text-muted block">TP1</span>
                <span className="text-positive">
                  {t.tp1_price ? `$${t.tp1_price?.toLocaleString()}` : "—"}
                </span>
              </div>
              <div>
                <span className="text-muted block">Size</span>
                <span>{t.size}</span>
              </div>
            </div>

            <div className="flex gap-2">
              {isConfirming ? (
                <>
                  <button
                    onClick={() => handleClose(t)}
                    disabled={isLoading}
                    className="flex-1 py-1.5 rounded bg-negative/20 text-negative border border-negative/40 text-xs font-bold hover:bg-negative/30 transition-colors"
                  >
                    Confirm close
                  </button>
                  <button
                    onClick={() => setConfirm(null)}
                    className="px-3 py-1.5 rounded border border-border text-muted text-xs hover:text-text transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleClose(t)}
                  disabled={isLoading}
                  className="w-full py-1.5 rounded border border-border text-muted text-xs hover:border-negative hover:text-negative transition-colors disabled:opacity-50"
                >
                  {isLoading ? "Closing..." : "Close position"}
                </button>
              )}
            </div>

            {errors[t.id] && (
              <div className="mt-2 px-3 py-1.5 rounded bg-negative/10 border border-negative/30 text-xs text-negative">
                Error: {errors[t.id]}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
