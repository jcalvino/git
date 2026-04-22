import React, { useMemo } from "react";

/**
 * SetupPerformance — tabela com performance por setup.
 * Cada linha: setup, trades, win rate, avg R, total $, expectativa.
 * Mostra qual setup funciona (e qual está drenando capital).
 *
 * Props:
 *   bySetup: [{ setup_id, trades, wins, losses, winRate, avgR, totalPnl, avgPnl }]
 */
export function SetupPerformance({ bySetup = [] }) {
  const rows = useMemo(() => {
    return [...bySetup]
      .filter((s) => s.trades > 0)
      .sort((a, b) => (b.totalPnl || 0) - (a.totalPnl || 0));
  }, [bySetup]);

  if (!rows.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 shadow-card">
        <h2 className="text-xs text-muted tracking-[0.15em] font-medium mb-4">PERFORMANCE POR SETUP</h2>
        <p className="text-xs text-muted-dim">Sem trades fechados com setup identificado.</p>
      </div>
    );
  }

  const totalTrades = rows.reduce((s, r) => s + (r.trades || 0), 0);
  const totalPnl    = rows.reduce((s, r) => s + (r.totalPnl || 0), 0);

  const setupLabels = {
    TREND_PULLBACK:         "Trend Pullback",
    BREAKOUT_RETEST:        "Breakout & Retest",
    LIQUIDATION_ZONE:       "Liquidation Zone",
    ORDERBOOK_ABSORPTION:   "OB Absorption",
    OI_CONFIRMATION:        "OI Confirmation",
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs text-muted tracking-[0.15em] font-medium">PERFORMANCE POR SETUP</h2>
          <p className="text-[10px] text-muted-dim mt-0.5">
            {totalTrades} trades ·
            <span className={`ml-1 font-mono font-bold ${totalPnl >= 0 ? "text-positive" : "text-negative"}`}>
              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
            </span>
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-muted-dim border-b border-border">
              <th className="text-left py-2 px-2 font-medium tracking-wider">SETUP</th>
              <th className="text-right py-2 px-2 font-medium tracking-wider">TRADES</th>
              <th className="text-right py-2 px-2 font-medium tracking-wider">WIN %</th>
              <th className="text-right py-2 px-2 font-medium tracking-wider">AVG R</th>
              <th className="text-right py-2 px-2 font-medium tracking-wider">TOTAL $</th>
              <th className="text-right py-2 px-2 font-medium tracking-wider">AVG $</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const wr = r.winRate ?? (r.trades > 0 ? (r.wins / r.trades) * 100 : 0);
              const wrColor =
                wr >= 55 ? "text-positive"
                : wr >= 40 ? "text-warning"
                : "text-negative";
              const pnlColor = r.totalPnl >= 0 ? "text-positive" : "text-negative";
              const rColor  =
                r.avgR >= 1.5 ? "text-positive"
                : r.avgR >= 0.5 ? "text-warning"
                : "text-negative";
              return (
                <tr key={r.setup_id} className="border-b border-border/50 hover:bg-card-alt transition-colors">
                  <td className="py-2.5 px-2 text-text">
                    {setupLabels[r.setup_id] ?? r.setup_id}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono text-text-dim">
                    <span>{r.trades}</span>
                    <span className="text-[10px] text-muted-dim ml-1">
                      ({r.wins}W/{r.losses}L)
                    </span>
                  </td>
                  <td className={`py-2.5 px-2 text-right font-mono font-semibold ${wrColor}`}>
                    {wr.toFixed(0)}%
                  </td>
                  <td className={`py-2.5 px-2 text-right font-mono ${rColor}`}>
                    {(r.avgR ?? 0).toFixed(2)}R
                  </td>
                  <td className={`py-2.5 px-2 text-right font-mono font-bold ${pnlColor}`}>
                    {r.totalPnl >= 0 ? "+" : ""}${r.totalPnl.toFixed(2)}
                  </td>
                  <td className={`py-2.5 px-2 text-right font-mono text-[11px] ${r.avgPnl >= 0 ? "text-positive-dim" : "text-negative-dim"}`}>
                    {r.avgPnl >= 0 ? "+" : ""}${(r.avgPnl ?? 0).toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
