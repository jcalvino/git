import { useState } from "react";

/**
 * OpenPositions
 * - Default (sidebar/overview): compact vertical cards
 * - horizontal prop: responsive grid (1-2-3 cols) for the Trades tab
 */
export function OpenPositions({ trades = [], onClose, horizontal = false }) {
  const [loading, setLoading] = useState({});
  const [errors, setErrors]   = useState({});
  const [confirm, setConfirm] = useState(null);

  const handleClose = async (trade) => {
    if (confirm !== trade.id) {
      setConfirm(trade.id);
      return;
    }
    setConfirm(null);
    setLoading((p) => ({ ...p, [trade.id]: true }));
    setErrors((p)  => ({ ...p, [trade.id]: null }));
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
      <div className="text-muted text-sm text-center py-6">No open positions</div>
    );
  }

  return (
    <div
      className={
        horizontal
          ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
          : "space-y-2"
      }
    >
      {trades.map((t) => (
        <PositionCard
          key={t.id}
          trade={t}
          isLoading={loading[t.id]}
          isConfirming={confirm === t.id}
          error={errors[t.id]}
          onClose={handleClose}
          onCancelConfirm={() => setConfirm(null)}
        />
      ))}
    </div>
  );
}

function PositionCard({ trade: t, isLoading, isConfirming, error, onClose, onCancelConfirm }) {
  const isExternal = t.trade_type === "EXTERNAL";
  const fmt        = (v) => v > 0 ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

  return (
    <div className="rounded-lg border border-border bg-card p-3 text-xs flex flex-col gap-2">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <span className="px-2 py-0.5 rounded font-bold text-xs bg-accent/10 text-accent">
          {t.direction}
        </span>
        <span className="font-semibold text-text">{t.symbol}</span>
        {isExternal && (
          <span className="px-1.5 py-0.5 rounded bg-border/50 text-muted text-xs">
            BingX
          </span>
        )}
        {t.leverage > 1 && (
          <span className="px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 text-xs font-mono">
            {t.leverage}x
          </span>
        )}
        {t.setup_name && (
          <span className="ml-auto text-muted truncate max-w-[120px]" title={t.setup_name}>
            {t.setup_name.replace(/^Setup \d+ [—─] /, "")}
          </span>
        )}
      </div>

      {/* Price levels — Entry / SL / TP1 / TP2 / TP3 / Size */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-2">
        <PriceRow label="Entrada" value={fmt(t.entry_price)} />
        <PriceRow label="Tamanho" value={t.size} />
        <PriceRow label="SL"  value={fmt(t.sl_price)}  color="text-negative" />
        <PriceRow label="TP1" value={fmt(t.tp1_price)} color="text-positive" />
        <PriceRow label="TP2" value={fmt(t.tp2_price)} color="text-positive" />
        <PriceRow label="TP3" value={fmt(t.tp3_price)} color="text-positive" />
      </div>

      {/* Close button */}
      <div className="flex gap-2 mt-auto">
        {isConfirming ? (
          <>
            <button
              onClick={() => onClose(t)}
              disabled={isLoading}
              className="flex-1 py-1.5 rounded bg-negative/20 text-negative border border-negative/40 text-xs font-bold hover:bg-negative/30 transition-colors"
            >
              Confirm close
            </button>
            <button
              onClick={onCancelConfirm}
              className="px-3 py-1.5 rounded border border-border text-muted text-xs hover:text-text transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => onClose(t)}
            disabled={isLoading}
            className="w-full py-1.5 rounded border border-border text-muted text-xs hover:border-negative hover:text-negative transition-colors disabled:opacity-50"
          >
            {isLoading ? "Closing..." : "Close position"}
          </button>
        )}
      </div>

      {error && (
        <div className="px-3 py-1.5 rounded bg-negative/10 border border-negative/30 text-xs text-negative">
          Error: {error}
        </div>
      )}
    </div>
  );
}

function PriceRow({ label, value, color = "text-text" }) {
  return (
    <div>
      <span className="text-muted block leading-tight">{label}</span>
      <span className={`font-mono font-semibold ${color}`}>{value}</span>
    </div>
  );
}
