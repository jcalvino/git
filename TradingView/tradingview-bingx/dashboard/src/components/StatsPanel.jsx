import React from "react";

export function StatsPanel({ stats, overview }) {
  const balance = overview?.balance ?? {};
  const capital = balance.total ?? 200;
  const totalPnl = stats?.totalPnl ?? 0;
  const pnlPct = capital > 0 ? (totalPnl / (capital - totalPnl)) * 100 : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatCard
        label="Total Capital"
        value={`$${capital.toFixed(2)}`}
        sub={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)`}
        subColor={totalPnl >= 0 ? "text-positive" : "text-negative"}
      />
      <StatCard
        label="Win Rate"
        value={`${stats?.winRate ?? 0}%`}
        sub={`${stats?.winCount ?? 0}W / ${stats?.lossCount ?? 0}L`}
        highlight={stats?.winRate >= 50}
      />
      <StatCard
        label="Expectancy"
        value={`$${stats?.expectancy ?? 0}`}
        sub="per trade"
        highlight={(stats?.expectancy ?? 0) > 0}
      />
      <StatCard
        label="Max Drawdown"
        value={`${stats?.maxDrawdown ?? 0}%`}
        sub={`${stats?.totalTrades ?? 0} trades`}
        danger={(stats?.maxDrawdown ?? 0) > 10}
      />
    </div>
  );
}

function StatCard({ label, value, sub, subColor, highlight = false, danger = false }) {
  const valueColor = danger
    ? "text-negative"
    : highlight
    ? "text-positive"
    : "text-text";

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${valueColor}`}>{value}</div>
      {sub && (
        <div className={`text-xs mt-1 ${subColor ?? "text-muted"}`}>{sub}</div>
      )}
    </div>
  );
}
