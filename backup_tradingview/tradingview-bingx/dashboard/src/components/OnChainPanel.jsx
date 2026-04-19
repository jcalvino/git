import React from "react";

export function OnChainPanel({ overview }) {
  // On-chain data comes from the most recent signal inputs
  // For now we show a placeholder — will be populated once scanner runs
  const prices = overview?.prices ?? {};

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <MetricCard
        label="BTC Dominance"
        value="—"
        note="Updated on next scan"
      />
      <MetricCard
        label="Funding Rate BTC"
        value="—"
        note="Next scan"
      />
      <MetricCard
        label="Funding Rate ETH"
        value="—"
        note="Next scan"
      />
    </div>
  );
}

function MetricCard({ label, value, note, color }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${color ?? "text-text"}`}>
        {value}
      </div>
      {note && <div className="text-xs text-muted mt-1">{note}</div>}
    </div>
  );
}
